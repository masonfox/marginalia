# instance-access Specification

## Purpose

Optionally protects a Marginalia instance with a single shared password set by the operator, presenting a simple login flow so that only people who know the password can use the library.

## Requirements

### Requirement: Optional password set by one environment variable
Authentication SHALL be controlled solely by the `AUTH_PASSWORD` environment variable. When it is set to a non-empty value, password protection SHALL be enabled. When it is unset or empty, the instance SHALL be open without a login page, SHALL log a warning at startup, and SHALL show a persistent notice in the UI that the instance has no password. The password SHALL never be logged or sent to the browser.

#### Scenario: Password set in Compose
- **WHEN** the operator sets `AUTH_PASSWORD` in the Compose environment and starts the stack
- **THEN** the application starts with password protection enabled

#### Scenario: No password set
- **WHEN** the application starts with `AUTH_PASSWORD` unset or empty
- **THEN** all pages are accessible without logging in, a startup warning states that no password is set, and the UI shows a notice that the instance is unprotected

#### Scenario: Login page without a password
- **WHEN** no password is set and a user opens the login page
- **THEN** they are redirected to the library

### Requirement: Unauthenticated access is blocked
When a password is set, every page, server function, and API endpoint SHALL require a valid session, except the login page, the health endpoint, and static assets. A page request without a valid session SHALL redirect to the login page, preserving the originally requested path. A non-page request without a valid session SHALL receive HTTP 401.

#### Scenario: Visiting a page while logged out
- **WHEN** a logged-out user opens a passage URL
- **THEN** they are redirected to the login page, and after logging in they land on that passage URL

#### Scenario: API call while logged out
- **WHEN** an upload is attempted without a valid session
- **THEN** the request is rejected with HTTP 401 and nothing is stored

#### Scenario: Health check stays open
- **WHEN** the health endpoint is requested without a session
- **THEN** it responds normally

#### Scenario: Open redirect prevented
- **WHEN** the login page is given a return path pointing to another host
- **THEN** after logging in the user is sent to the library page instead

### Requirement: Login and logout
The system SHALL present a login page with a single password field. A correct password SHALL create a session and redirect to the requested page; an incorrect password SHALL show a generic error and create no session. The UI SHALL offer a logout action that ends the current session.

#### Scenario: Correct password
- **WHEN** a user submits the correct password
- **THEN** a session is created and the user is redirected to the page they originally requested, or the library if none

#### Scenario: Incorrect password
- **WHEN** a user submits an incorrect password
- **THEN** the login page shows "Incorrect password" and no session is created

#### Scenario: Logout
- **WHEN** a logged-in user selects logout
- **THEN** the session is ended and subsequent requests require logging in again

### Requirement: Persistent sessions
A session SHALL remain valid across browser restarts and application restarts until it expires after a configurable lifetime (default 30 days) or is ended by logout. Changing the configured password SHALL invalidate all existing sessions.

#### Scenario: Application restarted
- **WHEN** the application container restarts while a user is logged in
- **THEN** the user is still logged in

#### Scenario: Session expires
- **WHEN** a session is older than the configured lifetime
- **THEN** the next request requires logging in again

#### Scenario: Password changed
- **WHEN** the operator changes the password and restarts the application
- **THEN** every previously created session is invalid

### Requirement: Session cookie and request safety
The session cookie SHALL be HTTP-only, `SameSite=Lax`, and marked `Secure` when the instance is reached over HTTPS (directly or through a reverse proxy). State-changing requests whose `Origin` header names a different host SHALL be rejected.

#### Scenario: Behind an HTTPS proxy
- **WHEN** a user logs in through a TLS-terminating reverse proxy
- **THEN** the session cookie is marked `Secure`

#### Scenario: Cross-site form submission
- **WHEN** a page on another site submits a state-changing request to the instance using the user's cookie
- **THEN** the request is rejected

### Requirement: Login attempt limiting
After 10 failed login attempts from one client within 15 minutes, the system SHALL reject further login attempts from that client until the window has elapsed, without revealing whether the password would have been correct.

#### Scenario: Repeated wrong passwords
- **WHEN** a client submits 10 incorrect passwords within 15 minutes and then the correct one
- **THEN** the eleventh attempt is rejected with a message to try again later and no session is created

#### Scenario: Other clients unaffected
- **WHEN** one client is being rate-limited
- **THEN** a different client can still log in with the correct password
