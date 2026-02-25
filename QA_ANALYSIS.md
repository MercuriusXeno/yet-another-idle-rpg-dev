# QA Analysis: Memory Leaks and Performance Issues

**Project:** Yet Another Idle RPG (by Miktaew)
**Codebase:** ~33K lines of vanilla JavaScript across ~31 source files
**Suspected regression range:** v4.5 - v4.6.1
**Analysis date:** 2026-02-24

---

## Table of Contents
- [Critical Severity](#critical-severity)
- [High Severity](#high-severity)
- [Medium Severity](#medium-severity)
- [Low Severity](#low-severity)
- [Summary](#summary)

---

## Critical Severity

### 1. Window Resize Event Listeners Added/Removed Every Tick
**File:** `src/main.js`, lines 5158-5206
**Pattern:** Window resize listeners are added and removed on every game tick (~1 second intervals) based on weather state transitions

```javascript
// Every tick, inside update():
if(!was_raining && game_options.do_background_animations) {
    window.removeEventListener("resize", start_stars_animation);
    if(new_temperature >= 0) {
        window.addEventListener("resize", start_rain_animation);
        window.removeEventListener("resize", start_snow_animation);
        start_rain_animation();
    } else {
        window.addEventListener("resize", start_snow_animation);
        window.removeEventListener("resize", start_rain_animation);
        start_snow_animation();
    }
}
```

**Why it leaks:** While `addEventListener` with the same function reference does de-duplicate, the constant add/remove pattern is fragile and error-prone. If the same function is bound multiple times (e.g., via arrow functions or method references that differ), listeners accumulate without limit. The code also has multiple paths (rain/snow/stars/stopping) that each independently manage listeners, making it easy for edge cases to leave orphaned listeners.

**Fix:** Track the current animation state in a variable and only add/remove listeners on actual state transitions. Use a single resize handler that dispatches based on the current state, rather than swapping listeners.

---

### 2. Temperature Tooltip DOM Element Recreated Every Tick
**File:** `src/display.js`, line 3766 (`create_temperature_tooltip()`) called by `update_displayed_temperature()` at line 3727
**Pattern:** A brand new DOM element is created every single game tick to replace the temperature tooltip

**Why it leaks:** Every ~1 second, a new DOM subtree is created and the old one is replaced. While the old one should be garbage collected, the constant creation and destruction of DOM nodes is extremely wasteful and can cause GC pressure. If any reference to old tooltip nodes is retained (e.g., via event handlers, closures, or dangling references), these nodes will accumulate in memory.

**Fix:** Create the tooltip once and update its text content on each tick instead of recreating the entire DOM structure.

---

### 3. New Game_Time Object Created Every Tick in Weather Calculation
**File:** `src/weather.js`, lines 163-170 (`get_current_temperature_smoothed()`)
**Pattern:** A new `Game_Time` object is instantiated on every call

```javascript
// Inside get_current_temperature_smoothed(), called every tick:
const future_time = new Game_Time({...});  // new allocation every tick
```

**Why it leaks:** Object allocation pressure on every tick. While individual `Game_Time` objects are small (~187 lines of code), the rapid allocation and discard pattern contributes to GC thrashing, especially combined with all other per-tick allocations.

**Fix:** Reuse a pre-allocated `Game_Time` object, updating its fields instead of creating a new one each time.

---

## High Severity

### 4. Tooltip DOM Elements Replaced on Every Inventory Update
**File:** `src/display.js`, lines 1224-1505
**Functions:** `update_displayed_trader_inventory()` (line 1224) and `update_displayed_character_inventory()` (line 1351)
**Pattern:** These functions destroy and recreate tooltip DOM trees for every item every time the inventory display updates

**Why it leaks:** Inventory updates happen frequently (buying, selling, looting, crafting). Each update recreates 15+ DOM elements per inventory item via `create_inventory_item_div()` (line 1576-1778). The old DOM nodes must be garbage collected, and if any references are retained by event handlers or closures, they will leak.

**Fix:** Use a diff-based approach: update existing DOM elements in place when item data changes, only create new elements for genuinely new items, and remove elements for items that no longer exist.

---

### 5. Effects Display Rebuilt from Scratch on Every Change
**File:** `src/display.js`, line 3684 (`update_displayed_effects()`)
**Pattern:** All active effect divs are removed and recreated whenever effects change

**Why it leaks:** Active effects change frequently during combat (damage over time, buffs, debuffs, weather effects). Each change triggers a complete DOM teardown and rebuild of the effects display section.

**Fix:** Track which effects are currently displayed. Add new effect elements, remove expired ones, and update changed ones in place.

---

### 6. JSON.parse Called in Sort Comparator for Trade Items
**File:** `src/trade.js`, lines 550-560 (`sort_traded_items()`)
**Pattern:** `getItemFromKey()` is called twice per comparison in the sort callback, and each call runs `JSON.parse()`

```javascript
// sort_traded_items():
traded_items.sort((a,b) => {
    // getItemFromKey(a) and getItemFromKey(b) each call JSON.parse()
});
```

**File:** `src/items.js`, line 1088 (`getItemFromKey()`)
**Pattern:** `JSON.parse()` is called every time an item needs to be retrieved from its inventory key

**Why it causes issues:** Sort comparators are called O(n log n) times. With JSON.parse running twice per comparison, a trade list of 50 items would trigger ~600 JSON.parse calls just to sort. This is compounded by `calculate_total_values()` (trade.js line 377-531) which also calls `getItemFromKey()` in multiple loops.

**Fix:** Cache parsed items in a Map before sorting. Pre-compute the sort keys. Consider using a WeakMap cache on the string keys to avoid redundant parsing.

---

### 7. JSON.stringify Used for Inventory Keys (Called Frequently)
**File:** `src/items.js`, lines 186-208 (`getInventoryKey()`)
**Pattern:** `JSON.stringify()` is called every time an inventory key is needed

**Why it causes issues:** Inventory key generation happens during virtually every inventory operation: adding items, removing items, crafting, trading, display updates, sort comparisons, and condition checks. `JSON.stringify` is relatively expensive and allocates a new string each time.

**Fix:** Cache the inventory key on the item object after first computation (memoization pattern). Invalidate only if item properties change.

---

### 8. Full Inventory Iteration for Shield Detection on Every Stat Update
**File:** `src/character.js`, lines 806-830 (`update_character_stats()`)
**Pattern:** Iterates over the ENTIRE inventory to find equipped shields every time character stats are recalculated

**Why it causes issues:** Character stats are recalculated frequently (on equipment change, level up, effect application, temperature change, etc.). Scanning the entire inventory each time is O(n) where n is inventory size, which grows throughout the game.

**Fix:** Track the equipped shield separately in a dedicated variable, updated only when equipment changes.

---

### 9. innerHTML += Pattern Causes Repeated DOM Reparse
**File:** `src/display.js`, lines 3560-3576 (stamina tooltip construction)
**Pattern:** Multiple `innerHTML +=` statements on the same element

```javascript
stamina_tooltip_div.innerHTML += "...";
stamina_tooltip_div.innerHTML += "...";
stamina_tooltip_div.innerHTML += "...";
// Each += triggers: serialize existing DOM -> concatenate string -> reparse entire HTML
```

**Why it causes issues:** Each `innerHTML +=` operation serializes the element's existing DOM tree to HTML, concatenates the new string, then reparses the entire combined HTML string back into DOM nodes. This is O(n^2) in the number of concatenations.

**Fix:** Build the complete HTML string first, then assign it once with a single `innerHTML =`. Or better yet, use `document.createElement()` and `appendChild()`.

---

### 10. Item Log Grows Unboundedly
**File:** `src/items.js`, lines 55-100 (`item_log` object, `log_item()` function)
**Pattern:** Every unique item ever encountered is logged and never pruned

**Why it leaks:** As the player progresses and encounters more items (especially crafted items with varying quality levels), the item log grows without bound. Each entry stores item data including display HTML. This data is also serialized in save files, causing save file bloat over time.

**Fix:** Implement a maximum size cap for the item log. Use an LRU eviction policy or limit to the N most recent entries. Consider only logging item IDs and reconstructing display data on demand.

---

### 11. Enemy Kill Count Grows Unboundedly
**File:** `src/enemies.js`, line 8 (`enemy_killcount` object)
**Pattern:** Kill counts for every enemy type are tracked indefinitely

**Why it leaks:** While the number of enemy types is bounded, this object is serialized in save files and loaded back. Combined with item_log and loot_sold_count, it contributes to progressive save file bloat.

**Fix:** This is a minor concern since enemy types are bounded. Consider if this data is actually needed for gameplay and prune if not.

---

## Medium Severity

### 12. Inventory Sorting Detaches and Reattaches All DOM Children
**File:** `src/display.js`, lines 1002-1222 (`sort_displayed_inventory()`)
**Pattern:** All inventory item DOM nodes are detached from the parent, sorted, and reattached

```javascript
[...parent.children].sort((a,b) => {
    // comparator with JSON.parse via getItemFromKey
}).forEach(node => parent.appendChild(node));
```

**Why it causes issues:** Detaching and reattaching DOM nodes triggers layout recalculations. The sort comparator also uses `getItemFromKey()` which calls `JSON.parse()`. This happens every time inventory display is refreshed.

**Fix:** Use CSS `order` property for visual sorting without DOM manipulation, or use `DocumentFragment` for batch operations. Pre-cache sort keys.

---

### 13. Skill and Quest Sorting Also Detaches/Reattaches DOM Nodes
**File:** `src/display.js`, line 4546 (`sort_displayed_skills()`) and line 5157 (`sort_displayed_quests()`)
**Pattern:** Same detach/sort/reattach pattern as inventory sorting

**Fix:** Same as above - use CSS `order` or `DocumentFragment`.

---

### 14. Per-Particle canvas.getContext("2d") Calls
**File:** `src/particles.js`, lines 24, 49, 78, 108
**Pattern:** Every particle object calls `canvas.getContext("2d")` in its constructor

```javascript
// In each particle constructor (Rain, Snow, Star, etc.):
this.ctx = canvas.getContext("2d");
```

**Why it causes issues:** While `getContext()` returns the same context object for subsequent calls on the same canvas, the lookup is unnecessary overhead when creating hundreds of particles per frame. Weather particles are created and destroyed constantly during rain/snow.

**Fix:** Get the canvas context once and share it across all particles via a module-level variable or constructor parameter.

---

### 15. Character Stats Recalculation is Expensive
**File:** `src/character.js`, lines 504-604 (`character.update_stats()`)
**Functions:** `add_active_effect_bonus()` (line 318-344) and `add_all_equipment_bonus()` (line 350-387)
**Pattern:** Both functions reset ALL bonuses from scratch and recalculate everything, even when only a single effect or equipment piece changed

**Why it causes issues:** Stats are recalculated frequently. Each recalculation iterates over all effects, all equipment, and all stat categories. This is expensive as the player accumulates more effects and equipment.

**Fix:** Use a dirty-flag system. Only recalculate the specific bonus categories that changed. Cache intermediate results.

---

### 16. Item Log Display Rebuilt Every Call
**File:** `src/display.js`, line 3866 (`update_displayed_item_log()`)
**Pattern:** The entire item log HTML table is rebuilt from scratch on every call

**Why it causes issues:** The item log can grow large over a play session. Rebuilding the entire table on each update (e.g., when a new item is found) becomes progressively slower.

**Fix:** Only append new entries to the existing table. Remove old entries from the DOM when they are pruned from the data.

---

### 17. loot_sold_count Structure Grows with Market Saturation
**File:** `src/market_saturation.js`, line 4 (`loot_sold_count` object)
**Pattern:** Tracks sold counts per region, per item group, per tier. Grows as the player sells more item types across more regions.

**Why it causes issues:** This data structure is serialized in save files. As the player engages more in trading, it grows, contributing to save file bloat. The `trickle_market_saturations()` function (line 96-151) also iterates over the entire structure every tick.

**Fix:** Consider pruning entries that have fully recovered (sold === recovered) since they have no effect on prices.

---

### 18. process_conditions() Iterates Entire Inventory via JSON.parse
**File:** `src/conditions.js`, lines 100-118
**Pattern:** When checking item conditions, iterates entire inventory and calls `JSON.parse(item_key)` for each item

```javascript
Object.keys(character.inventory).forEach(item_key => {
    const {id} = JSON.parse(item_key);
    if(id === item_id && character.inventory[item_key].count >= ...) {
        found = true;
    }
});
```

**Why it causes issues:** Condition checking happens for dialogues (every time a dialogue is opened), actions, and other game events. Each check parses every inventory key via JSON.parse.

**Fix:** Maintain a separate index mapping item IDs to their inventory keys, updated when inventory changes. Or store the item ID directly on the inventory entry instead of only in the key.

---

### 19. Crafting Recipe get_availability() Iterates Entire Inventory
**File:** `src/crafting_recipes.js`, lines 82-112 (`get_availability()` method)
**Pattern:** For material-type lookups, iterates through entire inventory

```javascript
Object.keys(character.inventory).forEach(key => {
    if(character.inventory[key].item.material_type === this.materials[i].material_type ...) {
        mats.push(character.inventory[key]);
    }
});
```

**Why it causes issues:** Called when displaying crafting UI, which happens every time the crafting panel is opened or refreshed. Sorts results as well.

**Fix:** Pre-index inventory items by material_type for O(1) lookup.

---

## Low Severity

### 20. format_time() Mutates Its Input Object
**File:** `src/game_time.js`, line 132
**Pattern:** `time.minutes = Math.ceil(time.minutes)` modifies the passed-in time object

**Why it causes issues:** This is a mutation side-effect bug rather than a memory leak. Callers may not expect their time objects to be modified. Could cause subtle display or calculation errors.

**Fix:** Create a shallow copy of the time object before modifying it, or pass the value rather than the object.

---

### 21. Floating Combat Effects Create DOM Elements with setInterval
**File:** `src/display.js`, lines 243-280 (`create_floating_effect()`)
**Pattern:** Creates a DOM element with a setInterval for animation, cleaned up via setTimeout after 4 seconds

**Why it is low severity:** The cleanup mechanism exists and appears correct - setTimeout removes the element and clearInterval stops the timer after 4 seconds. However, if `clearInterval` or element removal fails for any reason (e.g., parent node removed first), the interval would continue running indefinitely.

**Fix:** Add a safety check in the interval callback to verify the element still exists in the DOM. Use `requestAnimationFrame` instead of `setInterval` for smoother animation with automatic cleanup.

---

### 22. Activity Text Animation Uses setInterval
**File:** `src/display.js`, lines 926-949 (`start_activity_animation()`)
**Pattern:** setInterval for animating dots on activity text

**Why it is low severity:** The interval is stored and cleared when the activity stops. The pattern is correct but relies on the cleanup always being called.

**Fix:** Defensive programming - verify the interval is cleared in all code paths that can stop an activity (including error paths).

---

### 23. Message Log Has Per-Category Caps
**File:** `src/display.js`, lines 656-818 (`log_message()`)
**Pattern:** Message log has category-based caps and removes oldest when exceeded

**Why it is low severity:** This is actually a good pattern - it prevents unbounded growth. However, the caps may be generous enough to accumulate significant DOM nodes over a long session.

**Fix:** No action needed unless profiling reveals this as a bottleneck. Consider reducing caps if memory becomes an issue.

---

### 24. PriorityQueue Uses Array Sort Instead of Heap
**File:** `src/pathfinding.js`, lines 11-31
**Pattern:** `add_to_queue` calls `this.queue.sort()` after every insertion

```javascript
add_to_queue(location_element) {
    this.queue.push(location_element);
    this.queue.sort((a,b) => a[0] - b[0]);
}
```

**Why it causes issues:** Sorting on every insertion is O(n log n) instead of O(log n) for a proper binary heap. However, this is called infrequently (only when pathfinding to a new location) and the number of locations is small.

**Fix:** Replace with a binary heap implementation if the number of locations grows significantly.

---

### 25. Stance getStats() Creates New Object on Every Call
**File:** `src/combat_stances.js`, lines 47-64 (`getStats()`)
**Pattern:** Creates a new `multipliers` object every call

**Why it is low severity:** Called during combat stat calculations. The object is small and short-lived.

**Fix:** Cache the result and invalidate when the related skill levels up.

---

### 26. Verifier Runs Full Validation on Startup
**File:** `src/verifier.js`, lines 17-441 (`Verify_Game_Objects()`)
**Pattern:** Iterates all game objects (items, skills, locations, enemies, dialogues, recipes) for validation

**Why it is low severity:** This runs once on startup. It creates no persistent allocations. However, it does iterate over every game object, which could slow initial load times.

**Fix:** Only run in development mode. Add a flag to skip verification in production builds.

---

## Summary

### Findings by Severity

| Severity | Count | Primary Category |
|----------|-------|-----------------|
| Critical | 3 | DOM recreation, event listener management, per-tick allocations |
| High | 8 | DOM thrashing, JSON.parse in hot paths, unbounded data structures |
| Medium | 8 | Inefficient iteration, save file bloat, unnecessary recalculation |
| Low | 7 | Minor inefficiencies, side-effect bugs, defensive programming |

### Most Likely Causes of the Reported Memory Leak (v4.5-v4.6.1)

Based on the analysis, the most probable contributors to the reported memory leak are:

1. **Temperature tooltip recreation every tick** (Critical #2) - This was likely introduced alongside the weather/temperature system, which would align with a v4.5-v4.6 timeframe if that is when weather was added or reworked.

2. **Window resize listener management in the game loop** (Critical #1) - The weather animation system's resize listener add/remove pattern in the main loop is a prime candidate for listener accumulation over long sessions.

3. **New Game_Time object allocation every tick** (Critical #3) - Combined with the tooltip recreation and other per-tick allocations, this creates significant GC pressure.

4. **Tooltip DOM replacement on inventory updates** (High #4) - If inventory updates became more frequent in v4.5-v4.6, this would cause noticeable DOM node accumulation.

5. **Item log unbounded growth** (High #10) - If item logging was expanded or made more aggressive in v4.5-v4.6, it would cause progressive memory growth.

### Recommended Priority for Fixes

1. Fix the temperature tooltip to update in place instead of recreating (Critical #2) -- highest impact, easiest fix
2. Refactor resize listener management to use state tracking (Critical #1) -- high impact, moderate difficulty
3. Cache `Game_Time` objects instead of reallocating (Critical #3) -- moderate impact, easy fix
4. Add item cache for `getItemFromKey()` to avoid repeated `JSON.parse` (High #6, #7) -- high impact across trade, conditions, and sorting
5. Implement diff-based DOM updates for inventory and effects (High #4, #5) -- high impact, higher difficulty
6. Cap the item log size (High #10) -- moderate impact, easy fix
7. Cache shield reference in character stats (High #8) -- moderate impact, easy fix
8. Fix `innerHTML +=` pattern (High #9) -- moderate impact, easy fix
