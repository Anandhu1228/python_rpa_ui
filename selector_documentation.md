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
