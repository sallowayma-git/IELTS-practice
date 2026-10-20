# Integration findings

- Snapshot has 5 unique commits; target has 6. Source workspace was clean at isolation.
- Both branches use migrations 31-33 for different SQL; migrator only checks MAX(version).
- Local backup 19 includes soul_revisions; remote backup 19 includes context snapshots, latest 20.
- Local prose digest and remote typed report both use schemaVersion 2 but incompatible shapes.
- Five reported modify/delete paths are source additions, absent at common base, not remote deletions.
- prompt_skill.rs tests really were removed remotely and must stay removed.
- Remote owns current weekly_report_list/current, deterministic blocks, narrative whitelist and ACL.
- Local reading asset tags, dashboard/navigation/design system, notebook art and dev mock are independent value.

## Port inventory
Source d5d83ab8: reading asset questionKinds and UI filtering; relocate migration.
Source 2a53568c: dev-only browser mock; adapt to target commands.
Source 75ca0bd7: independent shell/dashboard/UI/art; preserve target fixes when paths overlap.
Source 1fc063d7: select independent writing/history/reading UI only; do not restore old weekly protocol.
Source 01157c95: card readability intent; keep target window/journal semantics.
