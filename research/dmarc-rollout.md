# DMARC rollout for vosslabs.org

Written 2026-07-14. Owner: Harshal.

## Why this matters more for us than for most people

vauth is passwordless. Email is not a notification channel — it **is** the credential. No OTP means no login, for every student, across every VOSS product.

So a spoofing campaign against `vosslabs.org` is not a reputational problem, it is an **outage**. If someone forges mail from our domain and the big providers start junking us, students stop receiving codes and cannot get in. DMARC is what prevents that.

Microsoft already enforces SPF + DKIM + DMARC for high-volume senders into Outlook (the published threshold is 5,000 messages/day — we are well under it, but the bar only ever moves one way). The college is on Microsoft. So this is the mailbox provider that decides whether our students can log in.

## The rollout, in three stages

Do not skip to `p=reject`. If any sender on `vosslabs.org` is unaligned — a forms tool, a CI notifier, Google Workspace, a newsletter — enforcement will quarantine **our own mail**, and for us that means locking students out of every product. Stage 1 exists to find those senders before they can hurt us.

### Stage 1 — observe (now, run for 2–3 weeks)

Cloudflare DNS, `vosslabs.org`:

```
Type:  TXT
Name:  _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc@vosslabs.org; fo=1
```

`p=none` changes nothing about delivery. It only asks receivers to send us reports. Route `dmarc@vosslabs.org` to a real inbox via Cloudflare Email Routing.

Also confirm, in Resend's domain view, that **SPF and DKIM both pass and are aligned** with `vosslabs.org`.

### Stage 2 — read the reports (after ~2–3 weeks)

Aggregate reports arrive as XML, one per provider per day. They are unpleasant to read raw — paste them into a free parser (dmarcian's or Postmark's) rather than squinting at them.

**The one question you are answering:** *is every source sending legitimate mail as `vosslabs.org` passing SPF or DKIM, aligned?*

Expect to see:
- **Resend** — should be aligned via DKIM. This is our OTP mail. It must be clean.
- **Unknown sources you forgot about** — this is the whole point of Stage 1. Anything sending as `vosslabs.org` that you did not set up.
- **Forwarders** — mail forwarded through a mailing list often breaks SPF but keeps DKIM. Normal, not a problem, as long as DKIM survives.

**Do not advance until every legitimate source passes.** If something legitimate is failing, fix its alignment first. Advancing with a broken sender is how you take down your own login.

### Stage 3 — enforce

Once the reports are clean for at least a week:

```
v=DMARC1; p=quarantine; pct=100; sp=quarantine; rua=mailto:dmarc@vosslabs.org; fo=1
```

Run that for another 2–3 weeks, keep watching. Then, if still clean:

```
v=DMARC1; p=reject; pct=100; sp=reject; rua=mailto:dmarc@vosslabs.org; fo=1
```

`sp=` governs subdomains and must match `p=`. `accounts.vosslabs.org` is a subdomain — if `sp=` is missing or weaker, it becomes the soft spot an attacker aims at.

## What this does NOT get us

**A logo in the sender avatar.** That would need BIMI, and **Microsoft does not render BIMI at all** — confirmed by Microsoft, May 2026: *"Microsoft does not currently support BIMI rendering in Exchange Online or Outlook."* Our recipients are on Microsoft. A $1,499 Verified Mark Certificate would change nothing. The purple "V" initials disc is not fixable at any price. Do not spend money or time here.

DMARC is worth doing entirely on its own merits. The logo is not on the table.

## Checklist

- [ ] Cloudflare Email Routing: `dmarc@`, `accounts@`, `admin@` → a real inbox
- [ ] Verify `accounts@vosslabs.org` as a sender in Resend
- [ ] Publish `_dmarc` TXT with `p=none`
- [ ] Confirm SPF + DKIM aligned in Resend
- [ ] Wait 2–3 weeks. Read the aggregate reports.
- [ ] Every legitimate sender aligned? → `p=quarantine; sp=quarantine`
- [ ] Another 2–3 weeks clean? → `p=reject; sp=reject`

## Sources

- Microsoft, BIMI unsupported in Exchange Online (2026-05-21): https://learn.microsoft.com/en-us/answers/questions/5569074/does-exchange-online-support-bimi-verification
- Outlook requirements for high-volume senders: https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730
- Resend DMARC/BIMI docs: https://resend.com/docs/dashboard/domains/bimi
- BIMI Group, where logos display (Microsoft absent): https://bimigroup.org/where-is-my-bimi-logo-displayed/
