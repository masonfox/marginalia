import { randomUUID } from "node:crypto";
import { expect, type Page, type Route, test } from "@playwright/test";
import pg from "pg";

// Side threads: the panel, its markers, the shared busy state, Bring to main,
// and the phone drawer. The chat endpoint is replaced by a stand-in that
// stores what the server would, so reloads show the same conversation.

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });

test.afterAll(async () => {
	await db.end();
});

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
	pageErrors = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
	expect(pageErrors).toEqual([]);
});

async function login(page: Page) {
	if (!PASSWORD) {
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		return;
	}
	await page.goto("/login");
	await page.getByLabel("Password").fill(PASSWORD);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL("/");
	await page.waitForLoadState("networkidle");
}

const MAIN_REPLY =
	'Hal reads the dictionary because [[cite locator="x:v1:0.0" quote="claim"]] he wants every word. The rest of the reply is about something else entirely.';

/** A conversation about the Manifesto with one saved assistant reply (and filler before it). */
async function conversation(filler = 0) {
	const { rows } = await db.query(
		"select id from editions where title = 'The Communist Manifesto' and status = 'ready' limit 1",
	);
	const editionId = rows[0]?.id as string;
	const id = randomUUID();
	const reply = randomUUID();
	await db.query("insert into conversations (id,title) values ($1,$2)", [
		id,
		"Thread test",
	]);
	await db.query(
		"insert into conversation_editions (conversation_id,edition_id,ordinal) values ($1,$2,0)",
		[id, editionId],
	);
	let seq = 0;
	for (let i = 0; i < filler; i++) {
		await db.query(
			"insert into messages (conversation_id,seq,role,parts) values ($1,$2,'user',$3)",
			[
				id,
				++seq,
				JSON.stringify([
					{
						type: "text",
						text: `Filler question ${i}.\n\n${"Words. ".repeat(60)}`,
					},
				]),
			],
		);
	}
	await db.query(
		"insert into messages (id,conversation_id,seq,role,parts,finish_reason) values ($1,$2,$3,'assistant',$4,'stop')",
		[reply, id, ++seq, JSON.stringify([{ type: "text", text: MAIN_REPLY }])],
	);
	return { id, reply };
}

/** A stored thread with one exchange, as the server would have saved it. */
async function storedThread(
	conversationId: string,
	anchor: string,
	quote: string,
	answer = "The thread reply says more about words.",
) {
	const threadId = randomUUID();
	const reply = randomUUID();
	await db.query(
		"insert into conversation_threads (id,conversation_id,anchor_message_id,anchor_quote) values ($1,$2,$3,$4)",
		[threadId, conversationId, anchor, quote],
	);
	const next = await nextSeq(conversationId);
	await db.query(
		"insert into messages (conversation_id,thread_id,seq,role,parts) values ($1,$2,$3,'user',$4)",
		[
			conversationId,
			threadId,
			next,
			JSON.stringify([{ type: "text", text: "Tell me more." }]),
		],
	);
	await db.query(
		"insert into messages (id,conversation_id,thread_id,seq,role,parts,finish_reason) values ($1,$2,$3,$4,'assistant',$5,'stop')",
		[
			reply,
			conversationId,
			threadId,
			next + 1,
			JSON.stringify([{ type: "text", text: answer }]),
		],
	);
	return { threadId, reply };
}

async function nextSeq(conversationId: string) {
	const { rows } = await db.query(
		"select coalesce(max(seq),0)+1 as next from messages where conversation_id=$1",
		[conversationId],
	);
	return Number(rows[0]?.next);
}

const removeConversation = (id: string) =>
	db.query("delete from conversations where id=$1", [id]);

interface ChatBody {
	conversationId: string;
	message?: string;
	threadId?: string;
	newThread?: { anchorMessageId: string; quote: string };
	replyContext?: { messageId: string; text: string };
}

/**
 * Stands in for the chat endpoint: stores the user message and the reply
 * (creating a new thread first), then streams the reply, starting with the
 * thread chunk on a thread turn. `hold` delays the reply until released.
 */
async function fakeChat(page: Page, reply = "A thread answer.") {
	const bodies: ChatBody[] = [];
	let hold: Promise<void> | null = null;
	let release = () => {};
	await page.route("**/api/chat", async (route: Route) => {
		const body = route.request().postDataJSON() as ChatBody;
		bodies.push(body);
		let threadId = body.threadId ?? null;
		if (body.newThread) {
			threadId = randomUUID();
			await db.query(
				"insert into conversation_threads (id,conversation_id,anchor_message_id,anchor_quote) values ($1,$2,$3,$4)",
				[
					threadId,
					body.conversationId,
					body.newThread.anchorMessageId,
					body.newThread.quote,
				],
			);
		}
		const seq = await nextSeq(body.conversationId);
		await db.query(
			"insert into messages (conversation_id,thread_id,seq,role,parts) values ($1,$2,$3,'user',$4)",
			[
				body.conversationId,
				threadId,
				seq,
				JSON.stringify([
					...(body.replyContext
						? [
								{
									type: "data-reply-context",
									data: { version: 1, ...body.replyContext },
								},
							]
						: []),
					{ type: "text", text: body.message },
				]),
			],
		);
		const replyId = randomUUID();
		await db.query(
			"insert into messages (id,conversation_id,thread_id,seq,role,parts,finish_reason) values ($1,$2,$3,$4,'assistant',$5,'stop')",
			[
				replyId,
				body.conversationId,
				threadId,
				seq + 1,
				JSON.stringify([{ type: "text", text: reply }]),
			],
		);
		// Usage as the server records it, with the thread for a thread reply.
		await db.query(
			"insert into ai_usage (purpose,conversation_id,message_id,thread_id,provider,model,input_tokens,output_tokens,steps,complete) values ('conversation',$1,$2,$3,'fake','fake-model',1000,200,1,true)",
			[body.conversationId, replyId, threadId],
		);
		if (hold) await hold;
		const chunks = [
			{ type: "start", messageId: replyId },
			...(threadId
				? [{ type: "data-thread", data: { threadId }, transient: true }]
				: []),
			{ type: "text-start", id: "t" },
			{ type: "text-delta", id: "t", delta: reply },
			{ type: "text-end", id: "t" },
			{ type: "finish" },
		];
		await route.fulfill({
			status: 200,
			contentType: "text/event-stream",
			headers: {
				"x-vercel-ai-ui-message-stream": "v1",
				...(threadId && { "x-marginalia-thread-id": threadId }),
			},
			body: `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`,
		});
	});
	return {
		bodies,
		/** Holds the next replies until the returned function is called. */
		hold() {
			hold = new Promise((resolve) => {
				release = () => {
					hold = null;
					resolve();
				};
			});
			return () => release();
		},
	};
}

/** Selects `text` inside the first element matching `selector`, as a reader would. */
async function select(page: Page, selector: string, text: string) {
	await page
		.locator(selector)
		.first()
		.evaluate((root, wanted) => {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {
				const node = walker.currentNode as Text;
				const at = node.data.indexOf(wanted);
				if (at === -1) continue;
				const range = document.createRange();
				range.setStart(node, at);
				range.setEnd(node, at + wanted.length);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
				document.dispatchEvent(new Event("selectionchange"));
				return;
			}
			throw new Error(`text not found: ${wanted}`);
		}, text);
}

const mainInput = (page: Page) => page.getByLabel("Message", { exact: true });
const threadInput = (page: Page) =>
	page.getByLabel("Thread message", { exact: true });
const panel = (page: Page) => page.getByTestId("thread-panel");
const mainSend = (page: Page) =>
	page.getByTestId("chat-header").locator("xpath=..").getByRole("button", {
		name: "Send",
		exact: true,
	});
const threadSend = (page: Page) =>
	panel(page).getByRole("button", { name: "Send", exact: true });
const underlines = (page: Page) =>
	page.evaluate(() => CSS.highlights.get("thread-anchor")?.size ?? 0);
const threadParam = (page: Page) =>
	new URL(page.url()).searchParams.get("thread");

async function open(page: Page, path: string) {
	await page.goto(path);
	await page.waitForLoadState("networkidle");
	test.skip(
		await page.getByText("AI is not configured", { exact: true }).isVisible(),
		"Threads require configured AI",
	);
}

test.describe("side threads", () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test("starting a thread opens the panel, sends once, marks the anchor at once, and reopens after a reload", async ({
		page,
	}) => {
		const { id, reply } = await conversation();
		try {
			await login(page);
			await open(page, `/c/${id}`);
			const chat = await fakeChat(page);
			await mainInput(page).fill("Main draft");
			await select(page, `[data-reply-source="${reply}"]`, "every word");
			await page.getByRole("button", { name: "Thread", exact: true }).click();

			// The new thread: anchor quote, focused input, main draft untouched.
			await expect(panel(page)).toBeVisible();
			expect(threadParam(page)).toBe("new");
			await expect(page.getByTestId("thread-anchor")).toContainText(
				"every word",
			);
			await expect(threadInput(page)).toBeFocused();
			await expect(mainInput(page)).toHaveValue("Main draft");
			await expect(page.getByTestId("thread-chip")).toHaveCount(0);

			await threadInput(page).fill("What does he want with them?");
			await threadSend(page).click();
			await expect(panel(page).getByText("A thread answer.")).toBeVisible();
			expect(chat.bodies).toHaveLength(1);
			expect(chat.bodies[0]).toMatchObject({
				conversationId: id,
				message: "What does he want with them?",
				newThread: { anchorMessageId: reply, quote: "every word" },
			});
			expect(chat.bodies[0]?.threadId).toBeUndefined();

			// The address names the created thread, and the markers show without a reload.
			await expect.poll(() => threadParam(page)).toMatch(/^[0-9a-f-]{36}$/);
			const created = threadParam(page) as string;
			await expect(page.getByTestId("thread-chip")).toHaveText("1 thread");
			await expect.poll(() => underlines(page)).toBe(1);
			await expect(mainInput(page)).toHaveValue("Main draft");

			// A second message goes to the created thread.
			await threadInput(page).fill("And then?");
			await threadSend(page).click();
			await expect.poll(() => chat.bodies.length).toBe(2);
			expect(chat.bodies[1]).toMatchObject({ threadId: created });
			expect(chat.bodies[1]?.newThread).toBeUndefined();

			// Reload restores the open thread with its messages.
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(panel(page)).toBeVisible();
			await expect(
				panel(page).getByText("What does he want with them?"),
			).toBeVisible();
			await expect(page.getByTestId("thread-anchor")).toContainText(
				"every word",
			);

			// Close, then reopen from the chip and from the underline.
			await panel(page).getByRole("button", { name: "Close thread" }).click();
			await expect(panel(page)).toHaveCount(0);
			expect(threadParam(page)).toBeNull();
			await page.getByTestId("thread-chip").click();
			await expect(panel(page)).toBeVisible();
			expect(threadParam(page)).toBe(created);
			// Escape closes the panel.
			await panel(page).focus();
			await page.keyboard.press("Escape");
			await expect(panel(page)).toHaveCount(0);

			// An address naming an unknown thread opens no panel.
			await open(page, `/c/${id}?thread=${randomUUID()}`);
			await expect(
				page.getByRole("heading", { name: "Thread test" }),
			).toBeVisible();
			await expect(panel(page)).toHaveCount(0);
		} finally {
			await removeConversation(id);
		}
	});

	test("an unsent new thread survives a reload, and closing it stores nothing", async ({
		page,
	}) => {
		const { id, reply } = await conversation();
		try {
			await login(page);
			await open(page, `/c/${id}`);
			await select(page, `[data-reply-source="${reply}"]`, "dictionary");
			await page.getByRole("button", { name: "Thread", exact: true }).click();
			await threadInput(page).fill("Half a question");
			await page.waitForTimeout(400);
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(panel(page)).toBeVisible();
			await expect(threadInput(page)).toHaveValue("Half a question");
			await expect(page.getByTestId("thread-anchor")).toContainText(
				"dictionary",
			);
			await panel(page).getByRole("button", { name: "Close thread" }).click();
			await expect(panel(page)).toHaveCount(0);
			await expect(page.getByTestId("thread-chip")).toHaveCount(0);
			const { rows } = await db.query(
				"select count(*)::int as n from conversation_threads where conversation_id=$1",
				[id],
			);
			expect(rows[0]?.n).toBe(0);
		} finally {
			await removeConversation(id);
		}
	});

	test("while a thread replies, the main Send is unavailable with a notice and the main draft is kept", async ({
		page,
	}) => {
		const { id, reply } = await conversation();
		const { threadId } = await storedThread(id, reply, "every word");
		try {
			await login(page);
			await open(page, `/c/${id}?thread=${threadId}`);
			const chat = await fakeChat(page, "A slow answer.");
			const release = chat.hold();
			await threadInput(page).fill("Slowly, please.");
			await threadSend(page).click();
			await expect(
				panel(page).getByRole("button", { name: "Stop", exact: true }),
			).toBeVisible();

			await mainInput(page).fill("Typed while the thread replies");
			await expect(page.getByTestId("reply-in-progress")).toHaveText(
				/A reply is in progress/,
			);
			await expect(mainSend(page)).toHaveAttribute("aria-disabled", "true");
			await mainInput(page).press("Enter");
			expect(chat.bodies).toHaveLength(1);

			await expect(page.getByTestId("thread-usage-total")).toHaveCount(0);
			release();
			await expect(panel(page).getByText("A slow answer.")).toBeVisible();
			// The thread's total and the conversation's both include the reply, without a reload.
			await expect(page.getByTestId("thread-usage-total")).toHaveText(
				/^1\.2k tokens/,
			);
			await expect(page.getByTestId("usage-total")).toHaveText(/^1\.2k tokens/);
			await expect(panel(page).getByTestId("reply-usage")).toBeVisible();
			await expect(page.getByTestId("reply-in-progress")).toHaveCount(0);
			await expect(mainSend(page)).not.toHaveAttribute("aria-disabled", "true");
			await expect(mainInput(page)).toHaveValue(
				"Typed while the thread replies",
			);
		} finally {
			await removeConversation(id);
		}
	});

	test("Bring to main quotes a thread reply in the main composer, and the sent message links back to the thread", async ({
		page,
	}) => {
		const { id, reply } = await conversation();
		const { threadId, reply: threadReply } = await storedThread(
			id,
			reply,
			"every word",
		);
		try {
			await login(page);
			await open(page, `/c/${id}?thread=${threadId}`);
			const chat = await fakeChat(page, "Back in the main conversation.");
			await threadInput(page).fill("Thread draft");
			await select(
				page,
				`[data-reply-source="${threadReply}"]`,
				"says more about words",
			);
			const actions = page.getByRole("toolbar", { name: "Selection actions" });
			await expect(
				actions.getByRole("button", { name: "Thread", exact: true }),
			).toHaveCount(0);
			await actions.getByRole("button", { name: "Bring to main" }).click();

			// On a wide screen the panel stays, and the main input has focus.
			await expect(panel(page)).toBeVisible();
			await expect(mainInput(page)).toBeFocused();
			await expect(page.getByTestId("attachment-excerpt").first()).toHaveText(
				"says more about words",
			);
			await expect(threadInput(page)).toHaveValue("Thread draft");

			// The pending quote survives a reload.
			await mainInput(page).fill("Why does that matter?");
			await page.waitForTimeout(400);
			await page.reload();
			await page.waitForLoadState("networkidle");
			await expect(mainInput(page)).toHaveValue("Why does that matter?");
			await expect(page.getByTestId("attachment-excerpt").first()).toHaveText(
				"says more about words",
			);

			await mainSend(page).click();
			await expect(
				page.getByText("Back in the main conversation.", { exact: true }),
			).toBeVisible();
			expect(chat.bodies.at(-1)).toMatchObject({
				replyContext: { messageId: threadReply, text: "says more about words" },
			});
			expect(chat.bodies.at(-1)?.threadId).toBeUndefined();

			await page.goto(`/c/${id}`);
			await page.waitForLoadState("networkidle");
			const quote = page.getByTestId("reply-quote");
			await expect(quote.getByTestId("quote-from-thread")).toHaveText(
				"from a thread",
			);
			await quote.getByRole("button", { name: "Open thread" }).click();
			await expect(panel(page)).toBeVisible();
			expect(threadParam(page)).toBe(threadId);
		} finally {
			await removeConversation(id);
		}
	});

	test("resizing across the breakpoint keeps the thread's typed draft", async ({
		page,
	}) => {
		const { id, reply } = await conversation();
		const { threadId } = await storedThread(id, reply, "every word");
		try {
			await login(page);
			await open(page, `/c/${id}?thread=${threadId}`);
			await threadInput(page).fill("A draft that must survive");
			const wide = await panel(page).boundingBox();
			expect(wide?.width).toBeLessThan(600);

			await page.setViewportSize({ width: 360, height: 740 });
			await expect(threadInput(page)).toHaveValue("A draft that must survive");
			const narrow = await panel(page).boundingBox();
			expect(narrow).toMatchObject({ x: 0, y: 0, width: 360 });

			await page.setViewportSize({ width: 1280, height: 900 });
			await expect(threadInput(page)).toHaveValue("A draft that must survive");
			expect((await panel(page).boundingBox())?.width).toBeLessThan(600);
			await expect(mainInput(page)).toBeVisible();
		} finally {
			await removeConversation(id);
		}
	});
});

test.describe("thread drawer on a phone", () => {
	test.use({
		viewport: { width: 360, height: 740 },
		hasTouch: true,
		isMobile: true,
	});

	test("fills the screen with the anchor at the top, Back closes it at the same scroll, and Bring to main returns to the focused composer", async ({
		page,
	}) => {
		const { id, reply } = await conversation(4);
		const { threadId, reply: threadReply } = await storedThread(
			id,
			reply,
			"every word",
		);
		try {
			await login(page);
			await open(page, `/c/${id}`);
			const chip = page.getByTestId("thread-chip");
			await chip.scrollIntoViewIfNeeded();
			const scrollBefore = await page.evaluate(() => window.scrollY);
			expect(scrollBefore).toBeGreaterThan(0);
			await chip.click();

			await expect(panel(page)).toBeVisible();
			expect(threadParam(page)).toBe(threadId);
			expect(await panel(page).boundingBox()).toMatchObject({
				x: 0,
				y: 0,
				width: 360,
				height: 740,
			});
			const anchor = await page.getByTestId("thread-anchor").boundingBox();
			expect(anchor?.y).toBeLessThan(150);
			await expect(
				panel(page).getByRole("button", { name: "Back to the conversation" }),
			).toBeVisible();
			await expect(
				panel(page).getByRole("button", { name: "Close thread" }),
			).toBeHidden();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth - window.innerWidth,
				),
			).toBeLessThanOrEqual(0);

			// The composer stays at the bottom, above an on-screen keyboard
			// (which resizes the page: interactive-widget=resizes-content).
			await threadInput(page).focus();
			await page.setViewportSize({ width: 360, height: 420 });
			const input = await threadInput(page).boundingBox();
			expect((input?.y ?? 0) + (input?.height ?? 0)).toBeLessThanOrEqual(420);
			await expect(threadInput(page)).toBeInViewport();
			await page.setViewportSize({ width: 360, height: 740 });

			// Back closes the drawer and keeps the conversation where it was.
			await page.goBack();
			await expect(panel(page)).toHaveCount(0);
			expect(threadParam(page)).toBeNull();
			await expect
				.poll(() => page.evaluate(() => window.scrollY))
				.toBeCloseTo(scrollBefore, -1);

			// The back control closes it too; Bring to main closes it and focuses the main input.
			await chip.click();
			await expect(panel(page)).toBeVisible();
			await panel(page)
				.getByRole("button", { name: "Back to the conversation" })
				.click();
			await expect(panel(page)).toHaveCount(0);
			await chip.click();
			await select(
				page,
				`[data-reply-source="${threadReply}"]`,
				"says more about words",
			);
			await page.getByRole("button", { name: "Bring to main" }).click();
			await expect(panel(page)).toHaveCount(0);
			await expect(mainInput(page)).toBeFocused();
			await expect(page.getByTestId("attachment-excerpt")).toHaveText(
				"says more about words",
			);
		} finally {
			await removeConversation(id);
		}
	});
});
