# Security policy

ScanToPrint runs on a shop's PC and receives files from members of the public, so we take security reports seriously.

## Supported versions

Only the **latest release** gets security fixes. Installed copies update themselves, so a fix reaches shops as soon as a new release is published.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately instead:

1. Go to the repository's **Security** tab and choose **Report a vulnerability**.
2. Describe the problem, how to reproduce it, and what an attacker could do.

You'll get a reply within 7 days. Once a fix is released, we'll credit you in the release notes unless you prefer otherwise.

## Scope

Examples of what we especially want to hear about:

- A customer reading or deleting another customer's files or jobs
- Reaching the staff dashboard or API without logging in, or a staff account doing owner-only actions
- Uploads that lead to code execution or writing outside the storage folder
- Anything that could let someone ship a fake update to installed apps

## How updates are protected

Release updates are signed with a private key that only the maintainer holds. The app checks every update against the public key built into it and refuses anything that doesn't match. Git commits and release tags on `main` are signed too.
