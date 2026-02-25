# Yet Another Idle RPG - Optimization & Refactoring Roadmap

**Codebase**: ~33,000 lines of vanilla ES6 JavaScript
**Analysis Date**: 2026-02-24
**Companion Documents**: [QA_ANALYSIS.md](QA_ANALYSIS.md) | [FRONTEND_ANALYSIS.md](FRONTEND_ANALYSIS.md) | [GAMELOGIC_ANALYSIS.md](GAMELOGIC_ANALYSIS.md)

---

## Executive Summary

Three independent analysis passes (QA/memory-leak, frontend/rendering, game-logic/architecture) identified **26 QA issues**, **16 frontend issues**, and **19 architecture issues**. The findings converge on a clear narrative:

**The probable memory leak introduced in v4.5-v4.6.1 is the weather/temperature system.** Three critical issues tie directly to it:
1. The temperature tooltip DOM is destroyed and recreated every single game tick (~1s)
2. Window resize listeners for rain/snow/star animations are added/removed every tick instead of on state transitions
3. A new `Game_Time` object is allocated every tick for temperature smoothing

Beyond the leak, the codebase has accumulated significant structural debt: two god files (`main.js` at 5,787 lines, `display.js` at 5,612 lines), pervasive global mutable state, heavy DOM churn without dirty-checking, and extensive copy-paste patterns.

This roadmap is organized into 5 phases, ordered by impact-to-effort ratio.

---

## Phase 1: Stop the Bleeding (Memory Leak Fixes)
> **Goal**: Eliminate the suspected memory leak and highest-impact performance drains
> **Estimated scope**: ~8 targeted fixes, no architectural changes
> **Risk**: Low (isolated, surgical changes)

### 1.1 Fix Temperature Tooltip Recreation (CRITICAL)
- **Files**: `src/display.js:3727-3782`, `src/main.js:5218`
- **Problem**: `update_displayed_temperature()` runs every tick, fully destroys and rebuilds the tooltip DOM
- **Fix**: Create the tooltip once at init. On each tick, compare temperature to cached value; only update `textContent` of existing elements if changed
- **Impact**: Eliminates ~1 DOM subtree creation + destruction per second for the entire session

### 1.2 Fix Window Resize Listener Churn (CRITICAL)
- **Files**: `src/main.js:5158-5206`
- **Problem**: `addEventListener`/`removeEventListener` called every tick for rain/snow/star animations based on weather state
- **Fix**: Track current animation state in a variable. Only swap listeners on actual state transitions (clear→rain, rain→snow, etc.). Use a single resize handler that dispatches based on current state
- **Impact**: Eliminates potential listener accumulation over long sessions

### 1.3 Reuse Game_Time Object in Weather (CRITICAL)
- **Files**: `src/weather.js:163-170`
- **Problem**: `new Game_Time({...})` allocated every tick in `get_current_temperature_smoothed()`
- **Fix**: Pre-allocate a module-level `Game_Time` instance, update its fields in-place each tick
- **Impact**: Reduces GC pressure from per-tick object allocation

### 1.4 Replace Floating Effects setInterval with CSS Animations (HIGH)
- **Files**: `src/display.js:243-280`
- **Problem**: Each combat floating text creates a 30ms `setInterval` writing inline `style.top/left/opacity`, causing layout thrash. 10 concurrent effects = 333 callbacks/sec
- **Fix**: Use CSS `@keyframes` with `transform: translate()` and `opacity` (GPU-accelerated). Element auto-removes via `animationend` event
- **Impact**: Eliminates all JS-driven layout thrashing during combat

### 1.5 Fix innerHTML += Pattern (HIGH)
- **Files**: `src/display.js:3559-3577` (stamina), `3525-3553` (health), `3579-3603` (XP), `593-611` (effect tooltips)
- **Problem**: Sequential `innerHTML +=` causes O(n^2) serialize-parse cycles
- **Fix**: Build complete HTML string in a local variable, assign once with `innerHTML =`
- **Impact**: Eliminates redundant DOM parsing on every tooltip rebuild

### 1.6 Add Dirty-Checking to Per-Tick Display Updates (HIGH)
- **Files**: `src/main.js:5096+` (game loop), `src/display.js` (various update functions)
- **Problem**: Every tick unconditionally calls `update_displayed_temperature()`, `update_displayed_effects()`, `update_displayed_effect_durations()`, `update_export_button_tooltip()` regardless of whether data changed
- **Fix**: Set dirty flags when data changes. Display functions check flag and skip if clean
- **Impact**: Eliminates most per-tick DOM work when game state is stable (idle periods)

### 1.7 Cache JSON.parse Results for Item Keys (HIGH)
- **Files**: `src/items.js:186-208` (`getInventoryKey`), `src/items.js:1088` (`getItemFromKey`), `src/trade.js:550-560`, `src/conditions.js:100-118`
- **Problem**: `JSON.stringify` on every key generation, `JSON.parse` on every key lookup. Sort comparators trigger O(n log n) parses
- **Fix**: Memoize `getInventoryKey()` on the item object. Use a `Map` cache in `getItemFromKey()`. Pre-compute sort keys before sorting
- **Impact**: Eliminates hundreds of JSON parse/stringify calls per inventory operation

### 1.8 Cap Item Log Size (HIGH)
- **Files**: `src/items.js:55-100`
- **Problem**: `item_log` grows unbounded as player discovers items, bloating memory and save files
- **Fix**: Add a configurable max size (e.g., 500 entries). Evict oldest entries when cap is reached. Reconstruct display HTML on demand rather than storing it
- **Impact**: Bounds a linearly-growing data structure

---

## Phase 2: DOM & Rendering Performance
> **Goal**: Reduce DOM churn and rendering overhead
> **Estimated scope**: ~10 targeted refactors
> **Risk**: Low-Medium (UI-visible changes require testing)

### 2.1 Diff-Based Inventory Display Updates
- **Files**: `src/display.js:1224-1505`, `1576-1778`
- **Problem**: `update_displayed_trader_inventory()` and `update_displayed_character_inventory()` destroy and recreate all item DOM elements (including tooltips) on every update
- **Fix**: Track displayed items by key. Add new elements for new items, remove for gone items, update in-place for changed items

### 2.2 Diff-Based Active Effects Display
- **Files**: `src/display.js:3684`
- **Problem**: All effect divs torn down and rebuilt on every change
- **Fix**: Track displayed effects by ID. Add/remove/update incrementally

### 2.3 Fix Enemy Health Display Cascade
- **Files**: `src/display.js:1900-1916`
- **Problem**: `update_displayed_health_of_enemies()` calls full `update_displayed_enemies()` rebuild inside a loop for each dead enemy
- **Fix**: Set a flag, call rebuild once after the loop

### 2.4 Cache getComputedStyle Values
- **Files**: `src/display.js:1928-1929, 2541-2542`
- **Problem**: `getComputedStyle()` after `style.setProperty()` forces synchronous layout
- **Fix**: Read CSS custom property values once at init, cache in JS variables

### 2.5 Use DocumentFragment for Sort Operations
- **Files**: `src/display.js:1074-1222` (inventory), `4567-4596` (skills), `4667-4691` (stances), `4819-4833` (bestiary), `5158-5177` (quests)
- **Problem**: Sorting detaches and re-appends all children individually (N DOM mutations)
- **Fix**: Append sorted nodes to a `DocumentFragment` first, then append fragment to parent (1 DOM mutation)

### 2.6 Use Event Delegation for Dynamic Elements
- **Files**: `src/display.js` (24 `setAttribute("onclick", ...)`), `index.html` (38 inline `onclick=`)
- **Problem**: String-based onclick handlers, no delegation, implicit eval
- **Fix**: Single event listener on parent containers, dispatch via `event.target.dataset`

### 2.7 Fix Background Animation Double-Wrapping
- **Files**: `src/display.js:5396-5404`
- **Problem**: `setTimeout` wrapping `requestAnimationFrame` halves effective framerate to ~30fps
- **Fix**: Use `requestAnimationFrame` alone

### 2.8 Share Canvas Context Across Particles
- **Files**: `src/particles.js:24, 49, 78, 108`
- **Problem**: Every particle constructor calls `canvas.getContext("2d")`
- **Fix**: Get context once at module level, pass to constructors or use as class static

### 2.9 Generate Enemy Divs from Template
- **Files**: `index.html:207-630`
- **Problem**: 8 identical enemy div structures hardcoded (~400 lines of repetitive HTML)
- **Fix**: Use a `<template>` element, clone in JS

### 2.10 Optimize Message Log Removal
- **Files**: `src/display.js:656-818`
- **Problem**: `getElementsByClassName()[0]` linear scan to find oldest message per category
- **Fix**: Maintain per-category queues of DOM references, `shift()` to remove oldest

---

## Phase 3: Break Up the God Files
> **Goal**: Decompose `main.js` and `display.js` into focused modules
> **Estimated scope**: Major refactor, extract ~8 new modules
> **Risk**: Medium (requires careful dependency management)

### 3.1 Extract `save_manager.js` (~1,600 lines)
- Extract `create_save()` and `load()` from `main.js`
- Extract inventory deserialization into a reusable `deserialize_inventory()` helper (eliminates 3x duplication)
- Move version migration blocks into individual functions in a `migrations/` directory
- Define a save schema interface

### 3.2 Extract `combat_manager.js` (~500 lines)
- Move combat loop, attack resolution, damage calculation
- Consolidate duplicated timer correction logic into a `CombatTimer` utility
- Merge `do_enemy_combat_action` and `do_character_combat_action` into a parameterized `resolve_attack()`
- Clean API: `start_combat()`, `end_combat()`, `pause_combat()`

### 3.3 Extract `reward_processor.js` (~300 lines)
- Replace the 300-line `process_rewards()` monolith with a handler registry pattern
- Each reward type registers its handler function
- New reward types added by registering a handler, not modifying a giant if/else

### 3.4 Extract `crafting_manager.js` (~350 lines)
- Consolidate three near-identical crafting branches (items/components/equipment) into a strategy pattern
- Base crafting flow with hooks for result generation, quality calculation, XP gain

### 3.5 Extract `option_manager.js` (~250 lines)
- Replace 15+ near-identical option handler functions with a configuration-driven factory
- Define options as data objects: `{ key, css_class, target, on_enable, on_disable }`

### 3.6 Extract `game_state.js`
- Consolidate the ~30+ exported mutable variables from `main.js` into a `GameState` class
- Controlled access via getters/setters
- Emit change events for reactive UI updates

### 3.7 Split `display.js` into Domain Modules
- `display_combat.js` - enemy display, health bars, floating effects
- `display_inventory.js` - inventory rendering, equipment slots, tooltips
- `display_skills.js` - skill bars, stance display, bestiary
- `display_location.js` - location choices, action buttons, travel
- `display_hud.js` - health/stamina/XP bars, weather, effects, message log
- Keep `display.js` as a thin coordinator that imports and re-exports

### 3.8 Introduce Event Bus
- Create a simple `EventBus` with `emit(event, data)` and `on(event, handler)`
- Game logic modules emit events: `"enemy_killed"`, `"item_gained"`, `"location_changed"`, etc.
- Display modules subscribe to events instead of being called directly from game logic
- Breaks circular dependency chain between `main.js` and `display.js`

---

## Phase 4: Data Architecture & DRY
> **Goal**: Separate data from logic, eliminate duplication
> **Estimated scope**: Extract data files, create shared utilities
> **Risk**: Low-Medium (mostly moving data, not changing behavior)

### 4.1 Separate Data Definitions from Logic
Create a `data/` directory with pure data exports:
- `data/enemies.js` - enemy template definitions (extract from `src/enemies.js`)
- `data/locations.js` - location definitions (extract from `src/locations.js`)
- `data/items.js` - item template definitions (extract from `src/items.js`)
- `data/skills.js` - skill definitions with milestones (extract from `src/skills.js`)
- `data/recipes.js` - crafting recipe definitions (extract from `src/crafting_recipes.js`)
- `data/dialogues.js` - dialogue trees (extract from `src/dialogues.js`)
- `data/traders.js` - trader inventory templates (extract from `src/traders.js`)
- `data/effects.js` - effect definitions (extract from `src/active_effects.js`)
- `data/stances.js` - stance definitions (extract from `src/combat_stances.js`)

Logic files import from data files and instantiate classes.

### 4.2 Generic Stat Bonus Aggregator
- **Files**: `src/character.js:256-401`
- Replace 4 near-identical stat aggregation functions with a single `aggregate_bonuses(sources, target_flat, target_multiplier)` utility
- Each caller provides its specific source list

### 4.3 Consolidate Combat Action Handlers
- **Files**: `src/main.js:1631-1851`
- Merge `do_enemy_combat_action()` and `do_character_combat_action()` into `resolve_attack({attacker, defender, on_hit, on_miss, on_kill})`

### 4.4 Consolidate Resting/Sleeping Logic
- **Files**: `src/main.js:1022-1059`
- Extract `restore_stamina({rate, xp_source, xp_rate})` helper

### 4.5 Fix Inventory Key System
- Replace `JSON.stringify({id, quality})` keys with simple string keys: `"item_id:quality"`
- Eliminates JSON.stringify on every key creation and JSON.parse on every lookup
- Maintain a `Map<string, Item>` cache for reverse lookups

### 4.6 Extract Game Balance Constants
- Create `src/constants.js` with named constants for all magic numbers
- XP scaling factors, stamina thresholds, money loss percentages, hit chance breakpoints, market saturation caps, etc.

### 4.7 Fix Naming Inconsistencies
- `ammount` → `amount` (appears in main.js, locations.js, crafting_recipes.js, traders.js)
- `enemy_abilites` → `enemy_abilities` (enemies.js)
- Standardize on consistent naming convention across classes (currently mixed: `LocationActivity` vs `Combat_zone` vs `GameAction`)
- Convert `Game_Time` constructor function to ES6 class

---

## Phase 5: Polish & Hardening
> **Goal**: Improve robustness, clean up debt, optimize remaining patterns
> **Estimated scope**: Smaller targeted fixes
> **Risk**: Low

### 5.1 Add Validation to Save/Load
- Validate save data structure before applying migrations
- Add per-migration error handling instead of one giant try/catch
- Log migration progress for debugging

### 5.2 Remove Dead Code
- `src/traders.js:120-131` - commented-out `getItemPrice` method
- `src/quests.js:493-525` - commented-out test quest
- `src/crafting_recipes.js` - commented-out `scales_with_skill` references
- `src/display.js:26` - commented-out import
- `src/verifier.js` - commented-out verification block

### 5.3 Prune Market Saturation Data
- In `trickle_market_saturations()`, remove entries that have fully recovered
- Prevents unbounded growth of `loot_sold_count`

### 5.4 Cache Equipped Shield Reference
- **Files**: `src/character.js:806-830`
- Track equipped shield in a dedicated variable updated on equipment change
- Eliminates full inventory scan on every stat recalculation

### 5.5 Skip Verifier in Production
- **Files**: `src/verifier.js`
- Add a build flag to skip `Verify_Game_Objects()` in production builds
- Keep it running in development for data validation

### 5.6 Use CSS `order` for Visual Sorting
- Replace DOM detach/sort/reattach with CSS `order` property where applicable
- Zero DOM mutations for sorting operations

### 5.7 Optimize Condition Checking
- **Files**: `src/conditions.js:100-118`
- Maintain an item ID → inventory key index, updated on inventory changes
- Eliminates full inventory scan + JSON.parse per condition check

### 5.8 Self-Host Material Icons
- Replace Google CDN font load with a self-hosted subset of only the ~20 icons used
- Eliminates external dependency and reduces ~200KB load

---

## Quick Reference: Issue Cross-Map

| Phase | # Issues | Source Analysis | Severity Coverage |
|-------|----------|----------------|-------------------|
| Phase 1 | 8 | QA: 3 Critical, 5 High | All Critical + most High |
| Phase 2 | 10 | Frontend: all findings | High + Medium |
| Phase 3 | 8 | Game Logic: all Critical + High | Architectural debt |
| Phase 4 | 7 | Game Logic: DRY + Data | Medium structural |
| Phase 5 | 8 | All three: remaining items | Low + cleanup |

---

## Dependency Graph

```
Phase 1 (leak fixes) ─── no dependencies, start immediately
    │
    ▼
Phase 2 (DOM perf) ──── benefits from Phase 1 dirty-checking
    │
    ▼
Phase 3 (god files) ─── benefits from Phase 2 display modularity
    │
    ├──► Phase 4 (data/DRY) ── can partially run in parallel with Phase 3
    │
    ▼
Phase 5 (polish) ─────── after Phases 3-4 stabilize
```

---

*Generated from analysis of commit 009a0b1, branch master.*
