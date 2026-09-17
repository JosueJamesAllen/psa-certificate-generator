# PSA Certificate Generator

Makes training and event certificates for PSA Marinduque — one for every person
on your list, all with the same event details, in one PDF ready to print.

It runs entirely on your computer. There is nothing to install, no account, and
no internet needed.

---

## Opening it

Two ways, both the same app:

- **On this computer** — double-click **`index.html`**. It opens in Edge (or
  Chrome) and that's it. Works with no internet at all.
- **Online** — <https://psa-certificate-generator.netlify.app>. Handy on a
  machine that doesn't have the folder, or on a phone or tablet.

Whichever you use, the names you type and the PDFs you make stay on that device.
Nothing is uploaded.

> Your settings and logos are remembered **per device and per browser**. Set
> them up at your desk and the online version on another machine starts fresh —
> use **Backup** and **Restore** (below) to carry them across.

---

## Making a batch of certificates

### 1. Who gets a certificate

Three ways, use whichever suits:

- **Drop an Excel file** onto the box, or click *Choose file…*
- Click **Download Excel template** if you'd rather start from a blank one.
  It already has the right headings — hand it round, get it back, drop it in.
- Click **+ Add a person manually** for one or two people. No Excel needed.

The list appears below. Untick anyone who shouldn't get one. A ⚠ means a blank
name or a name that appears twice — worth a look before you print.

**Click any name or role to correct it** — a typo caught here is a certificate
you don't reprint. **A → Z** prints them in alphabetical order, and **Clear
list** takes everyone off and starts again. People you typed in by hand are
still there tomorrow; the app remembers them on this computer.

**The Excel only needs one column: `Full Name`.** There's an optional second
column, `Role`, explained further down.

It copes with the sheets people actually send: a title across the top before the
headings is skipped (it says so under the file name), and a plain list of names
with no headings at all works too. If it picks the wrong column, change it in
the little table under the file name.

### 2. Certificate details

Fill in the event. As you type, the grey text under each box shows exactly how
that line will read on the certificate:

| Box | Prints as |
|---|---|
| Certificate title | **Certificate of Participation** (big, in the middle) |
| Event / training title | the name of the training |
| Hours + type of training | *for 24 hours of foundational training* |
| Held on — From / To | *from 15 to 17 September 2026* |
| Venue / location | *at PSA PSO Marinduque Training Room, …* |
| Date issued | *Given this 17ᵗʰ day of September 2026.* |

The dates tidy themselves up: one day becomes "on 17 September 2026", and a
range crossing a month becomes "from 30 September to 2 October 2026".

The **Certificate title** box has a drop-down of the usual ones
(Participation, Appreciation, Recognition, Completion, Attendance, Training),
but you can type anything. Change it and the small line above the event
rewrites itself to match — "for actively participating in the" becomes
"in grateful appreciation for the invaluable support extended to the".

**The 👁 buttons** hide a line you don't need on this batch — no hours, no
venue, no date. The box stays filled in, it just doesn't print.

**"Wording of the small lines"** at the bottom opens up the little connector
lines ("This", "is presented to") if you ever need to word them differently.

### 3. Size and design

- **Certificate size** — A4, or half of A4.
- **Orientation** — portrait or landscape.
- **Paper to print on** — only for half-A4. *Its own size* puts one certificate
  on one A5 sheet. **2 per A4 sheet** puts two on an ordinary A4 sheet with a
  dotted line to cut along, which is what you want if the printer only holds A4.
- **Corner design** — the angular corners, a plain double border, or nothing.
  The colour pickers change the corner colour and the recipient's name colour.
- **Lettering** — *Classic serif* (the usual look) or *Trajan style* (formal
  Roman capitals for the title and the name).
- **Logos** — up to three, printed across the top-left in the order shown.

Then **Generate PDF**, check the preview on the right, and **Download** or
**Print**.

> When you print, set Scale to **Actual size** or **100%**. "Fit to page"
> shrinks the certificate and the A5 cut line won't be in the right place.

---

## The Role column — speakers and participants in one batch

Most people get the same line: *for actively participating in the*.

If you put something in a person's **Role** column, that replaces their line.
So a sheet like this:

| Full Name | Role |
|---|---|
| Richard B. Calub | |
| Juan Paolo Santos | as Resource Speaker in the |
| Benedict A. Solis | as Facilitator in the |

gives Richard the normal participant wording, and gives Juan and Benedict
"as Resource Speaker in the" / "as Facilitator in the" — all from one run.

---

## Adding your office's logos

Click **+ Add** next to Logos and pick a PNG or JPG. It goes into the first
empty logo slot and stays on this computer for next time.

The PSA seal is already built in. The **Bagong Pilipinas** logo isn't — add it
once with **+ Add** and it'll be there from then on.

Logos are saved **on this computer only**. A logo you add at your desk is not
on anyone else's machine. Use **Backup** (below) to carry them over.

---

## Settings

The ⚙ **Settings** button at the top right holds the things that rarely change:

- **Signatory 1** — name, title and office printed under the signature line.
- **Signatory 2** — turn it on to print a second signatory beside the first.
- **E-signature images** — **off by default, and that's usually right**: the
  certificate prints a blank line for a real signature. Turn it on only if the
  office wants a scanned signature printed instead.

**Backup** saves your settings, your logos and the current certificate details
into one file. **Restore** loads that file on another computer — that's how you
move everything to a new machine, since nothing is stored in the folder itself.

---

## Things worth knowing

- **Nothing leaves your computer.** No internet, no server, no account. The
  names you load and the PDFs you make stay on this machine.
- **Settings and logos live in the browser**, not in the folder. Copying the
  folder to another computer copies the app but not your logos — use Backup.
- **Preview looks right but the print is small?** The printer is scaling. Set
  Scale to Actual size / 100%.
- **A long event title just makes the text smaller** so everything still fits
  on the page. That's deliberate.

---

## For whoever maintains this

No build step — it's plain HTML, CSS and JavaScript.

```
node tools/build-assets.js    # rebuild assets.js after adding to assets/logos/
node tools/make-sample.js     # write sample-participants.xlsx
node tools/test-generate.js   # render every size/orientation to out/
node tools/raster.mjs out/a4-portrait.pdf out/r 1100   # PDF -> PNG to eyeball
node tools/uitest.js          # build _uitest.html for the headless UI test
```

`npm i` once for the two dev tools (`jimp`, `mupdf`). See `CLAUDE.md` for how
the layout engine works and what not to change.

---

*Made by James Allen M. Josue with Claude.*
