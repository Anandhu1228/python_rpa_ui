# RPA Studio — Selector Reference

Complete reference for all ways to select fields, buttons, and elements when building flow steps.

---

## 1. By `name` attribute
Most reliable for form fields. Almost every input in a traditional form has a `name`.

```html
<input name="password">        →  input[name="password"]
<input name="identifier">      →  input[name="identifier"]
<select name="country">        →  select[name="country"]
<textarea name="message">      →  textarea[name="message"]
```

---

## 2. By `id` attribute
Second most reliable. `id` is always unique on a page by definition.

```html
<input id="email">             →  #email
<input id="phone_field">       →  #phone_field
<button id="submitBtn">        →  #submitBtn
<div id="captcha-box">         →  #captcha-box
```

---

## 3. By `type` attribute
Useful when there is only one element of that type on the page.

```html
<input type="submit">          →  input[type="submit"]
<input type="checkbox">        →  input[type="checkbox"]
<input type="radio">           →  input[type="radio"]
<input type="file">            →  input[type="file"]
<button type="submit">         →  button[type="submit"]
```

---

## 4. By `class` attribute
Use only when the class is unique on that page. If multiple elements share the class, combine with nth-child (see #5).

```html
<input class="form-control">     →  input.form-control   or   .form-control
<div class="otp-input">          →  .otp-input
<button class="btn btn-primary"> →  button.btn.btn-primary
```

---

## 5. By `nth-child` / `nth-of-type`
When multiple elements share the same class or tag and have no unique identifier. Counting starts from 1.

```html
<!-- 6 identical OTP boxes -->
<input class="otp-input">      →  .otp-input:nth-child(1)
<input class="otp-input">      →  .otp-input:nth-child(2)
<input class="otp-input">      →  .otp-input:nth-child(3)
<input class="otp-input">      →  .otp-input:nth-child(4)
<input class="otp-input">      →  .otp-input:nth-child(5)
<input class="otp-input">      →  .otp-input:nth-child(6)

<!-- or by element type -->
<input class="otp-input">      →  input:nth-of-type(1)
<input class="otp-input">      →  input:nth-of-type(2)
```

---

## 6. By text content (Playwright-specific)
Only works for buttons and links. Matches visible text inside the element.

```html
<button>Verify with DigiLocker</button>   →  button:has-text("Verify with DigiLocker")
<a>Sign In</a>                            →  a:has-text("Sign In")
<button>Next</button>                     →  button:has-text("Next")
<button>Submit</button>                   →  button:has-text("Submit")
<button>Done</button>                     →  button:has-text("Done")
```

---

## 7. By `placeholder` attribute
Works when the input has visible hint text and no name or id.

```html
<input placeholder="Enter OTP">           →  input[placeholder="Enter OTP"]
<input placeholder="Search...">           →  input[placeholder="Search..."]
<input placeholder="Enter Aadhaar number"> →  input[placeholder="Enter Aadhaar number"]
```

---

## 8. By `value` attribute
Mostly used for radio buttons and pre-filled inputs.

```html
<input type="radio" value="male">         →  input[type="radio"][value="male"]
<input type="radio" value="female">       →  input[type="radio"][value="female"]
<input type="submit" value="Go">          →  input[value="Go"]
```

---

## 9. By `aria-label` / `data-*` attributes
Modern apps and SPAs often skip `name` and `id` and use these instead.

```html
<input aria-label="Phone Number">         →  input[aria-label="Phone Number"]
<input data-field="aadhaar">              →  input[data-field="aadhaar"]
<button data-action="verify">             →  button[data-action="verify"]
<input data-testid="otp-box">             →  input[data-testid="otp-box"]
```

---

## 10. Parent → child (descendant)
Scope a selector inside a specific container when the same element appears multiple times on the page in different sections.

```html
<div class="login-form">
  <input name="user">           →  .login-form input[name="user"]
  <button>Login</button>        →  .login-form button
</div>

<form id="kyc-form">
  <input type="text">           →  #kyc-form input[type="text"]
</form>
```

---

## 11. Inside iframe
Your code's `resolve_frame` handles this automatically. Give the selector exactly as you would for a normal page element — it searches the main page first, then all iframes.

```html
<iframe id="verifyIframe">
  <input class="otp-input">    →  .otp-input
  <button type="submit">       →  button[type="submit"]
</iframe>
```

No special syntax needed. Just use the inner element's selector directly.

---

## 12. Combining multiple attributes
Most precise option when a single attribute is not unique enough on its own.

```html
<input type="text" name="pin">
  →  input[type="text"][name="pin"]

<input type="radio" name="gender" value="female">
  →  input[type="radio"][name="gender"][value="female"]

<button class="btn" type="submit">
  →  button.btn[type="submit"]

<input type="text" class="otp-input" placeholder="Enter OTP">
  →  input.otp-input[placeholder="Enter OTP"]
```

---

## 13. Attribute contains / starts-with / ends-with
When you only know part of an attribute value, not the full thing.

```html
<!-- contains (*=) — href contains the word "logout" anywhere -->
<a href="/auth/logout?next=/">Log Out</a>    →  a[href*="logout"]

<!-- starts-with (^=) — href begins with "/auth" -->
<a href="/auth/login">Login</a>              →  a[href^="/auth"]

<!-- ends-with ($=) — href ends with "/login" -->
<a href="https://example.com/login">         →  a[href$="/login"]

<!-- works on any attribute, not just href -->
<input class="otp-input-box-1">             →  input[class*="otp-input"]
<div data-action="submit-form">             →  div[data-action*="submit"]
```

---

## 14. File upload fields (`file_upload` field type)
Used when the target page has an `<input type="file">` element. The selector rules are the same as any other field — pick whichever method from #1–#13 uniquely identifies the file input. The most common patterns:

```html
<input type="file" name="photo">          →  input[name="photo"]
<input type="file" id="doc-upload">       →  #doc-upload
<input type="file">                       →  input[type="file"]
<input type="file" class="file-picker">   →  input.file-picker
<input type="file" accept="image/*">      →  input[accept="image/*"]
```

**How the CSV column value works for file uploads:**
The CSV column (or literal value) must contain the **absolute path on the server** where RPA Studio is running — not a URL, not a filename alone. The Playwright browser process reads the file directly from disk and sets it on the input element.

| Where your files live | What to put in the CSV column |
|---|---|
| On the **same machine** running RPA Studio (bare metal / local Docker) | Absolute local path: `/home/user/docs/photo.jpg` or `C:\Users\user\docs\photo.jpg` |
| Inside the **Docker container** | Path inside the container: `/app/storage/uploads/photo.jpg` |
| On a **network share / NFS** mounted into the container | Mount the share as a volume in `docker-compose.yml`, then use the mount path: `/mnt/nas/docs/photo.jpg` |
| On **S3 or any remote storage** | S3 files **cannot be used directly** — S3 is not a filesystem Playwright can read. You must download the file to the server first (see note below). |

**S3 workflow** — since Playwright cannot read S3 URLs directly, the recommended pattern is:
1. Before the RPA run, download each file from S3 to a local folder on the server (e.g. `/app/storage/uploads/`).
2. Put the resulting local path in the CSV column for that row.
3. Optionally delete the local copy after the run completes.

You can automate the download step with a simple script that runs before you start the RPA job, or upload the files via the RPA Studio **Uploads** tab (they land at `/app/storage/uploads/{filename}` inside the container).

**Three accept-type modes (set in Flow Builder, not in the CSV):**

| Mode | What it allows | Typical selector |
|---|---|---|
| `Any document` (default) | Any file type, no MIME check | `input[type="file"]` |
| `Image only` | Files whose MIME starts with `image/` — `.jpg`, `.png`, `.gif`, `.webp`, `.svg`, etc. | `input[name="photo"]` |
| `PDF / Document only` | `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.txt`, `.rtf` | `input[name="id_proof"]` |

**Size limit** — set **Max size (MB)** to `2` in the Flow Builder constraints panel to enforce a strict `< 2 MB` limit. Set to `0` (default) for no limit. The check happens before the file is set on the element — if the file is too large the row fails immediately with a clear log message.

---

## Priority Order

When you're looking at a field and deciding which selector to use, go down this list and stop at the first one that applies:

| Priority | Method | Use when |
|---|---|---|
| 1 | `#id` | Element has an `id` attribute |
| 2 | `input[name="x"]` | Input/select/textarea has a `name` attribute |
| 3 | `button:has-text("x")` | Button or link with visible text, no `id` or `name` |
| 4 | `input[aria-label="x"]` or `input[data-testid="x"]` | Modern SPA with no `name` or `id` |
| 5 | `input[placeholder="x"]` | Field has a unique placeholder and nothing else |
| 6 | `.classname` | Class is unique on that page |
| 7 | `button[type="submit"]` | Only one submit button exists on the page |
| 8 | `.classname:nth-child(n)` | Multiple identical elements sharing a class (e.g. OTP boxes) |
| 9 | `.parent .child` | Same element appears in multiple sections, need to scope it |
| 10 | `a[href*="x"]` | You only know part of the attribute value (contains/starts/ends) |
| 11 | Combine attributes | Nothing above is unique enough on its own |



---

## 15. Grouping Selectors (Logical OR)
You can combine multiple CSS selectors using a comma (`,`) to create a logical OR condition. The worker will trigger if **any** of the listed selectors are found.

```css
#send_err, .toast-container, .errormsg
```

How it works: This example tells the worker to watch the page for `#send_err` OR `.toast-container` OR `.errormsg`.

Use case: Useful when a page uses different types of error displays (like inline text and pop-up toasts) that you want to catch with a single error handling configuration.

Note: If any single selector in a comma-separated list is invalid, the entire rule may be ignored by the browser engine. Ensure all parts of your selector list are valid.

**⚠ Conflict warning — comma in `error_text_contains`:**
The comma is only meaningful in `error_selector`. The `error_text_contains` field is a plain text substring — it is NOT split on commas. If you type `Captcha did not match, Please try again` in `error_text_contains`, the worker looks for that entire string (including the comma) as one literal substring inside the element's text. You cannot use it as a logical OR for text matching. If you need to match multiple possible error texts, your only option is to leave `error_text_contains` blank (match any text the error element contains) and rely solely on `error_selector` to be specific enough.

---

## 16. Pseudo-class selectors supported in `error_selector` and `wait_for_selector`

Playwright uses a real browser engine, so all standard CSS pseudo-classes work in these fields:

**`:not(:empty)` — element exists in DOM but only match when it has content**
```css
#send_err:not(:empty)
```
Use this when the error container is always present in the HTML but only filled with text on error (like DigiLocker's `#send_err`). Without `:not(:empty)`, the worker would detect it immediately on page load even before any error occurs.

**`:not(.hidden)` / `:not([style*="display:none"])` — element exists but is CSS-hidden**
```css
.error-message:not(.hidden)
.alert:not([style*="display:none"])
```
Use when the site toggles a CSS class or inline style to show/hide the error rather than adding/removing the element from the DOM.

**`:visible` (Playwright-specific, not standard CSS)**
Playwright supports `:visible` as a pseudo-class in locators, but this does NOT work in `wait_for_selector` or `error_selector` since those use the standard browser CSS engine. Use `state="visible"` behavior is already built into how `check_error` evaluates matches — it calls `wait_for(state="visible")` internally, so elements that are in the DOM but hidden (display:none, visibility:hidden, opacity:0) are correctly ignored without you needing to add any pseudo-class.

---

## 17. Hidden behaviors and easter eggs in the worker

These are real behaviors built into the code that are not obvious from the UI:

**Jitter on all delays**
Every delay configured (between records, between fields, between steps, char typing delay) has ±20% random jitter applied automatically. A 1000ms delay will actually fire anywhere between 800ms and 1200ms. This is intentional to avoid bot-detection patterns that look for perfectly regular timing. You cannot disable it — it is always on.

**`select` field type tries value first, then label**
When filling a `<select>` dropdown, the worker first tries to match your CSV value against the option's `value` attribute. If that fails, it automatically retries matching against the option's visible `label` text. So for a dropdown like `<option value="IN">India</option>`, both `IN` and `India` will work in your CSV — no value_map needed.

**`checkbox` field type accepts multiple truthy/falsy strings**
The truthy values that will check the box: `yes`, `true`, `1`, `on`, `checked` (case-insensitive). Everything else unchecks it. So your CSV can use `Yes`, `TRUE`, `1`, or `yes` interchangeably.

**`radio` field type with `radio_name` auto-builds the selector**
If you fill in the "Radio name attribute" field in the Flow Builder, the worker ignores your selector entirely and constructs `input[type="radio"][name="<radio_name>"][value="<csv_value>"]` dynamically at runtime. The CSV value is used as the radio button's HTML `value` attribute to select the correct option.

**`human_input` with blank selector is valid**
If you set field type to `human_input` but leave the selector blank, the worker still asks the operator the question and waits for the response — it just does not fill anything into the page. Use case: asking for confirmation or collecting a value you intend to use in a later step via a different mechanism.

**`split_fill` handles shorter values gracefully**
If the value from the CSV (or from human input) is shorter than the total characters across all split boxes, the remaining boxes receive empty strings. No error is thrown — the short chunks are filled silently.

**`file_upload` with `external_url` supports Google Drive links**
If the URL in the CSV column is a standard Google Drive sharing link (`drive.google.com/file/d/...`) or a Google Docs link (`docs.google.com/.../d/...`), the worker automatically rewrites it to a direct download URL (`drive.google.com/uc?export=download&id=...`) before downloading. Regular Google Drive sharing links normally open a preview page, not the file — this rewrite bypasses that.

**`file_upload` temp files are cleaned up even if the upload fails**
Both `local_disk` and `external_url` file sources copy the file to `storage/temp_attachments/` with a job-scoped name before uploading. This temp copy is registered and deleted after `set_input_files()` completes — or at the end of the step even if an exception occurs — so temp files never accumulate.

**`wait_for_url` uses glob pattern matching**
The value you put in "Wait for URL to contain" is wrapped as `**your_value**` before being passed to Playwright. This means it is a glob pattern, not a plain substring or regex. The `**` on both sides means "match anything before and after". You do not need wildcards — just put the URL fragment you want to appear. However, if your fragment contains `*` or `?` characters, they will be interpreted as glob wildcards.

**Automatic error scraping on `wait_for_url` failure**
When `wait_for_url` times out (URL never matched), the worker automatically scans the page for elements matching `.error, .errorlist, [class*='error'], .alert-danger, .alert` and logs their text content to the developer log. This happens silently in the background — you do not configure it. It helps diagnose failures without looking at the video recording.

**Row recovery after failure**
When a row fails (any step returns False), the worker automatically attempts to navigate back to `base_url` before starting the next row. This is a best-effort reset — if the navigation itself fails, the error is silently swallowed and the next row starts from whatever page state the browser is in. If `base_url` is blank in the recipe, no recovery navigation happens.

**Stop requested check is at row boundary, not step boundary**
When you click Stop Run, the flag is checked at the start of each new row — not mid-step. The current row always completes all its steps fully before the stop takes effect. The job status is set to `done` (not `error`), and the video is saved normally.

**All selectors are automatically searched in iframes**
`resolve_frame` is called for every field fill. It first tries the main page, then iterates all iframes. This means you never need special syntax for elements inside iframes — just use the element's own selector directly. The same automatic iframe search applies to `wait_for_selector` and the captcha image/input selectors.