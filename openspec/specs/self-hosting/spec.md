# self-hosting Specification

## Purpose

Lets an individual or small household run Marginalia on their own hardware with a single container image, a PostgreSQL database, and a reference Docker Compose configuration.

## Requirements

### Requirement: Multi-architecture container image
The project SHALL publish a versioned container image for both `linux/amd64` and `linux/arm64`. Each release SHALL be tagged with its full semantic version (e.g. `0.1.0`), its minor line (e.g. `0.1`), and `latest` for the newest stable release.

#### Scenario: Pulling on an ARM64 host
- **WHEN** an operator on an ARM64 host pulls the image by a release tag
- **THEN** the container runtime selects the ARM64 variant and the application starts without emulation

#### Scenario: Pinning a version
- **WHEN** an operator references the image by a full semantic version tag
- **THEN** the image contents never change for that tag across subsequent releases

### Requirement: Reference Compose deployment
The project SHALL provide a reference Docker Compose file that starts the application and a PostgreSQL database with persistent named volumes for database data and application data, and an example read-only library mount.

#### Scenario: First start from the reference file
- **WHEN** an operator runs the reference Compose file with only the documented required variables set
- **THEN** the database and application start, migrations are applied, and the web UI is reachable on the configured port

#### Scenario: Data survives recreation
- **WHEN** the containers are removed and recreated with the same volumes
- **THEN** previously imported books, passages, and uploaded files remain available

### Requirement: Environment-based configuration with validation
The application SHALL read its configuration from environment variables, SHALL validate them at startup, and SHALL refuse to start with a message naming each invalid or missing required variable.

#### Scenario: Missing database URL
- **WHEN** the application starts without a database connection string
- **THEN** it exits with a non-zero status and an error naming the missing variable

#### Scenario: Invalid numeric setting
- **WHEN** a numeric setting such as the maximum upload size is not a positive number
- **THEN** the application exits with a non-zero status and an error naming that variable and the expected format

### Requirement: External PostgreSQL support
The application SHALL operate against any reachable PostgreSQL 16 or newer server given a connection string, without requiring the bundled database service.

#### Scenario: Using an existing database server
- **WHEN** an operator removes the bundled database service and points the connection string at an external PostgreSQL 16+ server
- **THEN** the application applies its migrations to that server and functions normally

### Requirement: Safe automatic migrations
The application SHALL apply pending database migrations at startup before serving requests or running jobs, and concurrently starting instances SHALL NOT apply the same migration twice.

#### Scenario: Upgrade to a release with new migrations
- **WHEN** an operator starts a newer image against a database created by an older release
- **THEN** pending migrations are applied once and the application then serves requests

#### Scenario: Migration failure
- **WHEN** a migration fails to apply
- **THEN** the application exits with a non-zero status, does not serve requests, and logs the failing migration

### Requirement: Health endpoint
The application SHALL expose an unauthenticated HTTP health endpoint that reports healthy only when the application can reach the database.

#### Scenario: Database reachable
- **WHEN** the health endpoint is requested while the database is reachable
- **THEN** it responds with HTTP 200

#### Scenario: Database unreachable
- **WHEN** the health endpoint is requested while the database is unreachable
- **THEN** it responds with HTTP 503

### Requirement: Reverse proxy compatibility
The application SHALL function when served at the root path of a hostname behind a TLS-terminating reverse proxy, including file uploads up to the configured maximum size.

#### Scenario: Served behind a proxy over HTTPS
- **WHEN** the application is reached through a reverse proxy that terminates TLS and forwards to the container over HTTP
- **THEN** pages load, uploads succeed, and any generated absolute URLs use the external scheme and host

### Requirement: Deployment documentation and security notice
The project SHALL document configuration variables, volumes, library mounts, external PostgreSQL, reverse proxy setup, and upgrades, and SHALL document how to set the instance password, that leaving it unset makes the instance open (suitable only on a trusted network or behind an authenticating proxy), and that the instance should be served over HTTPS when reachable beyond a trusted network.

#### Scenario: Operator reads setup documentation
- **WHEN** an operator follows the deployment documentation
- **THEN** every environment variable the application reads is listed with its default and purpose, and the password setup and HTTPS guidance are present

#### Scenario: Reference Compose file offers a password
- **WHEN** an operator opens the reference Compose file
- **THEN** it passes `AUTH_PASSWORD` through from the environment or an `.env` file, with a comment explaining that leaving it empty disables the login, and it never contains a default or placeholder password

### Requirement: AI provider configuration documented
The deployment documentation SHALL describe every AI environment variable with its default and purpose, give an example for a hosted provider and for a local OpenAI-compatible endpoint, and state that conversation text and retrieved passages are sent to the configured provider. It SHALL recommend a model setup (a current mid-tier model for conversations, a higher-quality alternative, and a small model for bulk work) with the reasoning behind it, explain prompt caching and reasoning effort and how they affect cost, state which settings current models ignore (such as temperature on current Anthropic models), explain how to override model prices, and state that the cost shown in the app is an estimate that may differ from the provider's bill.

#### Scenario: Operator enables AI
- **WHEN** an operator reads the documentation
- **THEN** they can configure a provider and understand what data leaves the instance

#### Scenario: Operator chooses a model
- **WHEN** an operator reads the AI section to pick a model
- **THEN** they find a recommended setup, the effort setting to start with, and how to see what conversations cost in the app

#### Scenario: Operator upgrading with a temperature set
- **WHEN** an operator with a temperature configured switches to a current Anthropic model
- **THEN** the documentation tells them the setting is ignored on that model and can be removed
