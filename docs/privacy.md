# Privacy Defaults

Dvar audit events omit raw arguments and tool output by default. Events record attributable identifiers, hashes, capabilities, decisions, rule IDs, reason codes, risk signals, and durations.

Applications remain responsible for classifying identifiers and may pseudonymize principal, tenant, resource, session, and task IDs before passing them to an event sink. Unsafe diagnostic capture must be explicit, bounded, and visibly marked.
