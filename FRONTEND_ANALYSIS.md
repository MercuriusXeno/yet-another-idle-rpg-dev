# Frontend Performance Analysis: Yet Another Idle RPG

**Analyzed files:**
- `src/display.js` (5612 lines) -- DOM rendering and UI updates
- `src/particles.js` (134 lines) -- particle effects system
- `src/main.js` (5530 lines) -- game loop driving display updates
- `index.html` (~2134 lines) -- static HTML structure
- `style.css` (~2611 lines) -- styles

---

## 1. DOM Leak Patterns

### 1.1 Temperature Tooltip Recreated Every Tick (CRITICAL)

**File:** `src/display.js`, lines 3727-3782; called from `src/main.js`, line 5218
**Severity:** CRITICAL

`update_displayed_temperature()` is called **every single game tick** (once per second) from the main `update()` loop. Each call:

1. Overwrites `weather_field.innerHTML` (destroying existing child nodes)
2. Calls `create_temperature_tooltip()` which creates a brand new `<div id="temperature_tooltip">` element via `document.createElement`
3. Appends it with `weather_field.appendChild(create_temperature_tooltip())`

This means every second, the old tooltip is implicitly orphaned by the innerHTML overwrite, then a new one is created and appended. While `innerHTML =` does destroy old children, the repeated create/destroy cycle is entirely wasteful since the temperature tooltip only needs updating when the temperature actually changes.

```javascript
// display.js:3763 -- called every tick
weather_field.appendChild(create_temperature_tooltip());
```

**Fix:** Cache the temperature tooltip element. Only recreate it when temperature or cold tolerance actually changes. Better yet, update only the text content of existing elements.

---

### 1.2 Floating Effect Elements with setInterval (HIGH)

**File:** `src/display.js`, lines 243-280
**Severity:** HIGH

`create_floating_effect()` appends a div to `document.body` and starts a `setInterval` that runs every 30ms. It is cleaned up after 4 seconds via `setTimeout` that clears the interval and calls `effect_elem.remove()`.

The concern: if `create_floating_effect` is called rapidly (e.g., during combat with fast attack speeds), many concurrent intervals (each at 30ms) will be running simultaneously. At any given time, if 10 floating effects exist, that is 10 intervals firing every 30ms = ~333 callbacks/second. Each callback does 3 inline style writes (`style.top`, `style.left`, `style.opacity`), triggering potential layout recalculations.

```javascript
// display.js:261-266 -- 30ms interval, style writes cause layout thrash
anim_interval = setInterval(()=> {
    effect_elem.style.top = effect_elem.posY - 2*timer**0.95 + "px";
    effect_elem.style.left = effect_elem.posX - Math.sin(timer/10)*20 + "px";
    effect_elem.style.opacity = (100-timer**.95)/100;
    timer++;
}, 30);
```

**Fix:** Replace `setInterval` + inline `style.top/left` with CSS animations or Web Animations API. A single `@keyframes` animation with `transform: translate()` and `opacity` would be GPU-accelerated and eliminate all the JS overhead and forced reflows.

---

### 1.3 Message Log Growth is Bounded but Inefficient (MEDIUM)

**File:** `src/display.js`, lines 656-818
**Severity:** MEDIUM

The message log has category-based caps (e.g., 80 combat messages, 28 loot messages). When a cap is hit, the oldest message of that category is removed:

```javascript
// display.js:803
message_log.removeChild(message_log.getElementsByClassName(group_to_add)[0]);
```

This is correct in preventing unbounded growth. However, the lookup `getElementsByClassName(group_to_add)[0]` must scan the entire message log DOM to find the first matching element. With up to ~244 total messages (80+28+40+40+28+28), this is a linear scan on every message add that exceeds the cap.

Also, every new message sets:
```javascript
// display.js:808
message.innerHTML = message_to_add + "<div class='message_border'> </>";
```
Note the malformed closing tag (`</>` instead of `</div>`). While browsers auto-correct this, it is a minor parsing overhead.

**Fix:** Maintain per-category queues (arrays) of DOM references. When removing the oldest, simply `shift()` from the array and call `.remove()` directly, avoiding the DOM scan. Fix the malformed HTML tag.

---

### 1.4 innerHTML Assignments Orphaning Children with Listeners (MEDIUM)

**File:** `src/display.js`, lines 2239, 2271, 2293, 2414
**Severity:** MEDIUM

Multiple location choice creation functions follow this pattern:

```javascript
// display.js:2239 (example from work category)
activity_div.appendChild(job_tooltip);
activity_div.innerHTML += `<i class="material-icons ...">...</i> ` + location.activities[key].starting_text;
```

The `innerHTML +=` operation first serializes the entire DOM subtree to a string, appends new HTML, then parses the result back. This **destroys** all existing child nodes and recreates them from scratch. If the `job_tooltip` element had event listeners attached (which these specific tooltips do not), those would be lost. More importantly, the serialize-parse round-trip is expensive compared to `appendChild` with a text node.

This pattern appears in at least 4 places in the location choice creation code.

**Fix:** Use `insertAdjacentHTML('beforeend', ...)` or create the icon element with `createElement` and `appendChild` instead of `innerHTML +=`.

---

### 1.5 Equipment Display Full Rebuild with innerHTML (MEDIUM)

**File:** `src/display.js`, lines 1783-1801
**Severity:** MEDIUM

`update_displayed_equipment()` iterates over all equipment slots and for each:

1. Sets `innerHTML` to the slot name (destroying all children including any existing tooltip)
2. Creates a brand new tooltip
3. Appends the tooltip

```javascript
// display.js:1790-1799
equipment_slots_divs[key].innerHTML = `${key.replace("_"," ")} slot`;
// ...
equipment_slots_divs[key].appendChild(eq_tooltip);
```

This full rebuild happens on every equipment change, even if only one slot changed.

**Fix:** Accept an optional slot parameter to update only the changed slot. Update tooltip content rather than recreating the entire structure.

---

## 2. Rendering Performance

### 2.1 Forced Reflows: getComputedStyle Immediately After Style Writes (HIGH)

**File:** `src/display.js`, lines 1928-1929, 2541-2542
**Severity:** HIGH

When switching between normal and combat locations:

```javascript
// display.js:1928-1929
document.documentElement.style.setProperty('--actions_div_height',
    getComputedStyle(document.body).getPropertyValue('--actions_div_height_default'));
document.documentElement.style.setProperty('--actions_div_top',
    getComputedStyle(document.body).getPropertyValue('--actions_div_top_default'));
```

Each `getComputedStyle()` call forces the browser to flush all pending style changes and compute current layout. Combined with the `style.setProperty` calls, this creates a forced synchronous layout (reflow). The pattern repeats for the combat variant at lines 2541-2542.

**Fix:** Read the CSS custom property values once at initialization time and cache them in JS variables, then use those cached values instead of calling `getComputedStyle` each time.

---

### 2.2 Stamina Tooltip: Repeated innerHTML += on Same Element (HIGH)

**File:** `src/display.js`, lines 3559-3577
**Severity:** HIGH

`update_stamina_bar_tooltip()` does up to 7 sequential `innerHTML +=` operations on the same element:

```javascript
// display.js:3560-3575
stamina_tooltip_div.innerHTML = "<b>Max stamina:</b> ...";
stamina_tooltip_div.innerHTML += create_stat_breakdown("max_stamina");
stamina_tooltip_div.innerHTML += "...<b>Stamina efficiency:</b>...";
stamina_tooltip_div.innerHTML += create_stat_breakdown("stamina_efficiency");
stamina_tooltip_div.innerHTML += "...<b>Stamina regen (flat):</b>...";
stamina_tooltip_div.innerHTML += create_stat_breakdown("stamina_regeneration_flat");
stamina_tooltip_div.innerHTML += "...<b>Stamina regen (%):</b>...";
stamina_tooltip_div.innerHTML += create_stat_breakdown("stamina_regeneration_percent");
```

Each `innerHTML +=` reads the current innerHTML (serializing the DOM), concatenates the string, and re-parses the entire thing. With 7 operations, the browser parses the HTML 7 times, each time re-parsing all previously added content too. This is an O(n^2) pattern on content size.

The same pattern exists in `update_health_bar_tooltip()` (lines 3525-3553) and `update_xp_bar_tooltip()` (lines 3579-3603).

**Fix:** Build the complete HTML string in a local variable, then assign `innerHTML` once at the end:
```javascript
let html = "<b>Max stamina:</b> " + ...;
html += create_stat_breakdown("max_stamina");
// ... build complete string ...
stamina_tooltip_div.innerHTML = html;
```

---

### 2.3 Effect Tooltip: innerHTML += in a Loop (MEDIUM)

**File:** `src/display.js`, lines 593-611
**Severity:** MEDIUM

Inside `create_effect_tooltip()`, the `tooltip.innerHTML +=` pattern is used inside a `for...of` loop iterating over effect stats:

```javascript
// display.js:594-610
for(const [key, stat_value] of Object.entries(effects.stats)) {
    tooltip.innerHTML += `<br>${capitalize_first_letter(stat_names[key])}`;
    if(stat_value.flat) {
        tooltip.innerHTML += `: ${sign}${Math.round(100*stat_value.flat)/100}`;
    }
    if(stat_value.multiplier) {
        tooltip.innerHTML += ...;
    }
}
```

Each iteration causes repeated serialize-parse cycles.

**Fix:** Build the string first, then set innerHTML once.

---

### 2.4 Background Animation Uses setTimeout + requestAnimationFrame Double-Wrapping (LOW)

**File:** `src/display.js`, lines 5396-5404
**Severity:** LOW

```javascript
// display.js:5397-5403
function do_background_animation() {
    background_animation_timeout = setTimeout(() => {
        background_animation = requestAnimationFrame(do_background_animation);
        context.clearRect(0,0,canvas.width, canvas.height);
        for(let i = 0; i < background_animation_particles.length; i++) {
            background_animation_particles[i].draw();
        }
    }, 1000/60);
}
```

This wraps `requestAnimationFrame` inside a `setTimeout(fn, 16.67)`. The `setTimeout` provides the throttling, while `rAF` provides the vsync scheduling -- but using both together means the animation won't actually run at 60fps. The `setTimeout` fires ~16.7ms later, then `rAF` schedules for the next frame, effectively halving the framerate to ~30fps, and adding timing jitter.

**Fix:** Use either `requestAnimationFrame` alone (for vsync-aligned updates) or `setTimeout` alone (for fixed-rate updates). Not both. If 60fps cap is desired, just use `rAF` and the browser handles the rate naturally.

---

### 2.5 Particle System: Each Particle Calls getContext("2d") (LOW)

**File:** `src/particles.js`, lines 24, 49, 78, 108
**Severity:** LOW

Every particle constructor calls `canvas.getContext("2d")` and stores the result. While browsers cache and return the same context object, this is unnecessary per-instance overhead:

```javascript
// particles.js:24
this.context = canvas.getContext("2d");
```

**Fix:** Pass the context to the constructor or make it a class-level static property.

---

### 2.6 update_displayed_health_of_enemies Calls update_displayed_enemies on Dead Enemies (MEDIUM)

**File:** `src/display.js`, lines 1900-1916
**Severity:** MEDIUM

```javascript
// display.js:1900-1916
function update_displayed_health_of_enemies() {
    for(let i = 0; i < current_enemies.length; i++) {
        if(current_enemies[i].is_alive) {
            enemies_div.children[i].children[0].style.filter = "brightness(100%)";
        } else {
            enemies_div.children[i].children[0].style.filter = "brightness(30%)";
            update_displayed_enemies(); // FULL REBUILD for every dead enemy!
        }
        // ...health bar update...
    }
}
```

When an enemy dies, `update_displayed_enemies()` is called inside the loop. If multiple enemies are dead, this triggers a full enemy display rebuild multiple times per health update cycle. The `update_displayed_enemies()` function iterates all 8 enemy slots and does heavy calculations (hit chance, evasion, etc.).

**Fix:** Set a flag if any enemy died, and call `update_displayed_enemies()` once after the loop completes.

---

## 3. UI Architecture Smells

### 3.1 No Diffing or Dirty-Checking -- Full Rebuilds Everywhere (HIGH)

**File:** `src/display.js`, entire file
**Severity:** HIGH (architectural)

The codebase has no concept of "has this data changed since last render?" Every update function unconditionally rebuilds its output. For example:

- `update_displayed_temperature()` fully rebuilds the weather display every tick, even when the temperature has not changed.
- `update_displayed_effects()` clears and rebuilds all effect tooltips on every call.
- `update_displayed_stats()` rewrites all stat values and their breakdowns on every call.

In the main game loop (`update()` in main.js, line 5096), **every single tick** calls:
- `update_displayed_temperature()` (line 5218)
- `update_displayed_effect_durations()` (line 5137)
- `update_displayed_effects()` (line 5138)
- `update_export_button_tooltip()` (line 5122)

Many of these could be skipped if the underlying data has not changed.

**Fix:** Implement a simple dirty-flag system. Each data source sets a flag when it changes. Display update functions check the flag and skip if clean.

---

### 3.2 Monolithic update_displayed_normal_location Rebuilds All Action Choices (MEDIUM)

**File:** `src/display.js`, lines 1918-2100
**Severity:** MEDIUM

`update_displayed_normal_location()` is a ~180-line function that:
1. Clears all action divs
2. Rebuilds the crafting button
3. Rebuilds the sleeping button
4. Rebuilds the storage button
5. Filters and rebuilds all dialogue choices
6. Filters and rebuilds all trader choices
7. Filters and rebuilds all job choices
8. Filters and rebuilds all training choices
9. Filters and rebuilds all gathering choices
10. Filters and rebuilds all action choices
11. Filters and rebuilds all travel choices
12. Filters and rebuilds all challenge choices
13. Filters and rebuilds all fast-travel choices

This is called every time the location view needs refreshing. Each category involves filtering arrays, creating multiple DOM elements, and setting innerHTML with string concatenation.

**Fix:** Cache the generated action divs per location. Only rebuild if the location or its state (unlocks, etc.) has changed. Or, generate location action content lazily on first view.

---

### 3.3 Inline onclick Handlers via setAttribute Instead of Event Delegation (MEDIUM)

**File:** `src/display.js`, 24 occurrences of `setAttribute("onclick", ...)`; `index.html`, 38 occurrences of `onclick=`
**Severity:** MEDIUM

Many dynamically created elements set `onclick` via `setAttribute`:

```javascript
// display.js:2176
dialogue_div.setAttribute("onclick", "start_dialogue(this.getAttribute('data-dialogue'));");
// display.js:2331
action.setAttribute("onclick", "change_location({location_id: this.getAttribute('data-travel')});");
```

These use string-based onclick handlers that are evaluated via the global scope, which:
1. Prevents tree-shaking and static analysis
2. Creates implicit `eval()`-like behavior
3. Misses event delegation opportunities
4. Cannot be cleaned up when elements are removed (minor leak vector)

**Fix:** Use event delegation on parent containers (e.g., `action_div`). A single event listener on the parent can inspect `event.target` and its `dataset` to determine the action. This reduces the total number of listeners from O(n) to O(1) per container.

---

### 3.4 Sorting Functions Detach and Re-Append All Children (LOW)

**File:** `src/display.js`, lines 1074-1222 (inventory), 4567-4596 (skills), 4667-4691 (stances), 4819-4833 (bestiary), 5041-5042 (booklist), 5158-5177 (quests)
**Severity:** LOW

All sorting functions follow this pattern:

```javascript
// display.js:1221
[...target.children].sort((a,b) => { ... }).forEach(node => target.appendChild(node));
```

This spreads all children into an array, sorts, then re-appends each one. `appendChild` of an already-parented node moves it (no duplication), but each call potentially triggers a reflow. For N items, this is N DOM mutations.

**Fix:** Use `DocumentFragment` -- append sorted nodes to a fragment first, then append the fragment to the parent in a single DOM operation. Or, use CSS `order` property for visual sorting without DOM manipulation.

---

### 3.5 Deep Child Access via Children Index Chains (LOW)

**File:** `src/display.js`, throughout (e.g., lines 1885-1913, 4474-4498)
**Severity:** LOW (maintainability + fragility)

Many places access deeply nested DOM children by numeric index:

```javascript
// display.js:1885-1889
enemies_div.children[i].children[0].children[1].children[0].innerText = html_string;
enemies_div.children[i].children[0].children[1].children[1].innerText = `Spd: ${disp_speed}`;
enemies_div.children[i].children[0].children[1].children[2].innerText = `Hit: ...`;
enemies_div.children[i].children[0].children[1].children[3].innerText = `Ddg: ...`;
enemies_div.children[i].children[0].children[1].children[4].innerText = `Def: ...`;
```

And:
```javascript
// display.js:4474
skill_bar_divs[skill.category][skill.skill_id].children[0].children[0].children[1].innerHTML = ...;
```

This creates extremely fragile code that breaks if any HTML structure changes, and is hard to maintain or optimize.

**Fix:** Assign class names or data attributes to key elements and use `querySelector` for lookups, or cache references at creation time in a structured object.

---

## 4. Asset and Resource Issues

### 4.1 Enemy Divs Hardcoded x8 in HTML (MEDIUM)

**File:** `index.html`, lines 207-630 (approximately)
**Severity:** MEDIUM

Eight identical enemy div structures are hardcoded in the HTML, each approximately 50 lines long. This accounts for ~400 lines of repetitive HTML. They differ only by their `id` attribute (`enemy_0_div` through `enemy_7_div`).

```html
<!-- Repeated 8 times with different IDs -->
<div id="enemy_0_div" class="enemy_div">
    <div>
        <div class="enemy_name"></div>
        <div class="enemy_stats">
            <div class="enemy_stat enemy_stat_long"></div>
            <!-- 4 more stat divs with separators -->
        </div>
        <div class="enemy_health_div">...</div>
        <div class="enemy_attack_bar"></div>
    </div>
</div>
```

**Fix:** Generate enemy divs dynamically in JS from a template, or use a single `<template>` element and clone it.

---

### 4.2 Google Material Icons Loaded from CDN (LOW)

**File:** `index.html`, line 12
**Severity:** LOW

```html
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
```

The Material Icons font is loaded from Google's CDN. If the CDN is slow or the user is offline, icons will not render. The font file itself is ~200KB.

**Fix:** Self-host the font file, or use a smaller icon subset containing only the ~20 icons actually used in the game.

---

### 4.3 CSS Custom Properties Used for Show/Hide Instead of Classes (LOW)

**File:** `style.css`, lines 2-96
**Severity:** LOW

The CSS root defines ~30+ custom properties for controlling visibility:

```css
--message_combat_display: inline-block;
--message_unlocks_display: inline-block;
--equipment_display: inline-block;
/* ... etc ... */
```

Toggling visibility via `document.documentElement.style.setProperty('--message_combat_display', 'none')` requires the browser to recalculate styles for all elements that reference that custom property, which can be broader than needed.

**Fix:** Use CSS class toggling on the specific container elements instead of global CSS custom property changes.

---

### 4.4 Outline Text Shadow Defined as CSS Custom Properties (LOW)

**File:** `style.css`, lines 92-95
**Severity:** LOW

```css
--outline_white: -1px -1px 0 #ffffff, 1px -1px 0 #ffffff, -1px 1px 0 #ffffff, 1px 1px 0 #ffffff;
--outline_black: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
```

Text outlines implemented via 4-direction `text-shadow` are expensive to render, especially on elements that change frequently (bars, status values). Each outlined element requires the text to be rasterized 5 times (4 shadows + original).

**Fix:** Use `-webkit-text-stroke` (widely supported now) for a similar effect with better performance, or limit outlines to static elements only.

---

## 5. Summary of Priority Fixes

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| CRITICAL | Temperature tooltip recreated every tick | Unnecessary DOM churn every second | Low |
| HIGH | Floating effects use setInterval + inline styles | Layout thrashing during combat | Medium |
| HIGH | Forced reflows via getComputedStyle after style writes | Synchronous layout | Low |
| HIGH | innerHTML += on same element (stamina/health tooltips) | O(n^2) HTML parsing | Low |
| HIGH | No dirty-checking on per-tick display updates | Wasted rendering work | Medium |
| MEDIUM | update_displayed_health_of_enemies calls full rebuild per dead enemy | Redundant heavy computation | Low |
| MEDIUM | innerHTML += destroys/recreates child nodes in location choices | Unnecessary DOM destruction | Low |
| MEDIUM | Message log uses DOM scan for oldest message removal | Linear scan per message | Low |
| MEDIUM | Monolithic location display rebuild | Large DOM rebuild on navigation | Medium |
| MEDIUM | Inline onclick via setAttribute | No event delegation, eval-like | Medium |
| MEDIUM | 8 enemy divs hardcoded in HTML | 400 lines of repetition | Low |
| LOW | Background animation double-wrapped setTimeout + rAF | ~30fps instead of 60fps | Low |
| LOW | Sorting detaches and re-appends all children individually | N DOM mutations | Low |
| LOW | Particle constructors each call getContext | Unnecessary per-instance call | Low |
| LOW | CSS custom props for visibility toggling | Broad style recalculation | Low |
| LOW | Text-shadow outlines on dynamic elements | Expensive paint | Low |

---

*Analysis performed on commit 009a0b1, branch master.*
