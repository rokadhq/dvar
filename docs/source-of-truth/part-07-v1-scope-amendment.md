# Accepted v1 scope and release amendment

Date: 15 October 2026. Decision owner: Rokad / project owner.

The owner has directed that Dvar will not ship again before v1 and that all 55
features in the approved expansion list must be implemented and qualified before
that release. This supersedes the earlier alpha-shipping decision and the limited
0.8/0.9 feature sequence in the original roadmap. It also brings previously
deferred functionality into v1 where listed in the new feature register.

The authoritative implementation register is [docs/v1/features.json](../v1/features.json),
with the readable plan at [IMPLEMENTATION_PLAN.md](../v1/IMPLEMENTATION_PLAN.md).
Milestones are internal work batches, not release commitments. A feature marked
in progress or implemented is not yet verified for release. Existing v0.7 APIs
must be requalified rather than assumed complete from historical CI results.

Dvar remains an independent, local-first, open-source action-security runtime.
Credential and identity integrations do not make it an identity provider or
secrets manager. Sandbox integration does not replace OS enforcement. Data
protection is scoped to protected flows and may integrate specialized DLP tools.
The optional approval/analytics interfaces do not gate offline policy evaluation.

Publication stays held until all 55 acceptance records have reviewed code,
test, documentation and security-review evidence, compatibility qualification
passes, and the owner explicitly approves the release. No version bump or
successful unit-test run alone satisfies that gate.
