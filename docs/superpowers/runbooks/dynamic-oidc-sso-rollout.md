# Dynamic OIDC SSO — rollout and recovery runbook

Status: **implementation in progress; do not deploy or merge until CI and security acceptance gates pass**.

## Safety invariants
- Local CMS username/password sign-in always remains available; the global switch controls external OIDC only.
- PostgreSQL is the authority for login policy, provider lifecycle/version, identity blocks and BFF sessions.
- Secrets are encrypted at rest and are never returned to clients, logged or cached in Redis.
- A published version is immutable. Recovery copies a historical version into a new untested Draft.
- Disable/Archive/global-off prevent new SSO callbacks; existing sessions remain unless separately revoked.
- Block revokes sessions only for the affected provider and subject; Unlink alone does not revoke.
- Unknown-origin legacy sessions must reauthenticate.
- Sensitive Admin changes require a CMS password step-up within ten minutes.

## Preflight
1. Verify Local Login using a CMS Super Admin account with a password.
2. Inventory legacy OIDC issuer/client/label settings, existing identity links with provider 'oidc', current sessions and database version. Do not export the client secret to tickets or logs.
3. Back up PostgreSQL and securely preserve OPENCLOUDCMS_SECRET; verify restore on a separate instance.
4. Ensure only one application generation is running across all nodes at cutover. No mixed static-configuration and dynamic-DB versions.
5. Verify outbound DNS/HTTPS restrictions, certificates and real IdP callback allowlists.

## Migrate
- oauth2_0004_dynamic_sso adds providers, immutable versions, default-off policy, blocks, health and import markers.
- oauth2_0005_sso_provenance adds PKCE-bound one-time provenance and BFF session origins.
- oauth2_0006_sso_health_counters adds separate probe success streak.
- Apply migrations using the normal application migrator, and verify global SSO login remains OFF.

## Import, Test, Publish and enable
1. Legacy OIDC environment/file settings are imported **once** into encrypted Draft 'oidc', preserving existing user identity links.
2. Review issuer, client ID, scopes, mapping and callback URI. The importer never automatically activates.
3. Test performs safe HTTPS discovery and JWKS validation, including required PKCE S256 support.
4. The Test **does not verify the client secret**: perform a real end-to-end staging login before production.
5. Publish a tested, unchanged Draft with the expected fingerprint and a recent CMS password step-up.
6. Enable the global SSO switch with expected revision. Verify Local Login still works.
7. Test disabling a provider during an ongoing callback, published-version rotation and targeted identity blocking.

## Emergency response
- Broken provider: Disable it; Local Login remains. Do not silently switch to env OIDC config.
- Compromised identity: Block provider + subject under password step-up, confirm targeted session revocation and audit.
- IdP outage: Examine health records and upstream discovery/JWKS. Recovery is assisted only, never automatic.
- Version recovery: create a new untested Draft from historical PUBLISHED/SUPERSEDED version; Test and Publish.
- Application rollback: restore compatible application/database versions. Do not reverse auth migrations on live data without a tested backup.
- Secret rotation: rotating OPENCLOUDCMS_SECRET invalidates token encryption and HMAC subject matching; plan block-list rekey and session reauthentication.

## Acceptance gates
- [ ] pnpm --filter @opencloudcms/oauth2 typecheck
- [ ] pnpm --filter @opencloudcms/core typecheck
- [ ] pnpm build
- [ ] pnpm test (PostgreSQL 16 and TEST_DATABASE_URL)
- [ ] Complete core migration and smoke-init tests
- [ ] Local Login remains working with SSO OFF and ON
- [ ] Imported 'oidc' identity links preserved; no JIT user creation
- [ ] Actual Entra, Keycloak and Google login callbacks verified in staging
- [ ] Verified/unverified email, stable subject, replay and CSRF/PKCE regression tests
- [ ] Disable/Archive/global-off reject callbacks; in-flight version expires within 600 seconds
- [ ] AS-to-BFF origin cryptographically bound; cross-user/interaction swap fails closed
- [ ] User Disable revokes all sessions; Block revokes only matching sessions; Unlink requires step-up
- [ ] No secret, raw subject, token, password or cookie in API, audit, logs or cache
- [ ] Health 5-minute schedule, 3-failure threshold, 2-success recovery, 30-day history
- [ ] Security review, cross-instance test and rollback exercise completed
- [ ] All PR CI checks green and reviewer approval before merge

## Release caution
Typecheck/build/unit tests alone do not prove client credentials, IdP-specific behavior, grant-store revocation or distributed races. Staging E2E and security sign-off remain hard release gates.
