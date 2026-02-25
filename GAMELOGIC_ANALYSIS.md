# Yet Another Idle RPG - Deep Architecture Analysis

**Codebase**: ~33,000 lines of vanilla ES6 JavaScript
**Analysis Date**: 2026-02-24
**Scope**: Game logic architecture, code quality, and refactoring opportunities

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [SOLID Principle Violations](#2-solid-principle-violations)
3. [DRY Violations](#3-dry-violations)
4. [Technical Debt](#4-technical-debt)
5. [Data Architecture Issues](#5-data-architecture-issues)
6. [Refactoring Opportunities](#6-refactoring-opportunities)
7. [Priority Matrix](#7-priority-matrix)

---

## 1. Executive Summary

The codebase is a browser-based idle RPG built with vanilla JavaScript ES6 modules. While it is functional and clearly the product of sustained development effort, the architecture has accumulated significant technical debt. The primary concerns are:

- **`main.js` is a ~5,800-line god file** that handles the game loop, combat, save/load, crafting, rewards, options, and more. This single file accounts for roughly 18% of the entire codebase and violates the Single Responsibility Principle extensively.
- **The save/load system spans ~1,600 lines** with extensive version-compatibility shims and heavily duplicated inventory deserialization logic.
- **Global mutable state** is pervasive, with dozens of module-level variables exported and mutated freely across files.
- **Copy-paste patterns** appear frequently, especially in option handlers, stat bonus aggregation, combat action handlers, and crafting branches.
- **Data definitions are mixed with logic**, with entity definitions (enemies, locations, skills, items) embedded in the same files as the classes and runtime logic that operates on them.

The codebase would benefit most from (1) breaking `main.js` into focused modules, (2) extracting a generic save/load serialization system, and (3) separating data definitions from logic.

---

## 2. SOLID Principle Violations

### 2.1 Single Responsibility Principle (SRP)

#### CRITICAL: `main.js` God File
- **File**: `src/main.js` (~5,787 lines)
- **Severity**: Critical
- **Pattern**: This single file is responsible for:
  - Game loop and tick processing (lines ~5096-5529)
  - Combat loop management with setTimeout recursion (lines ~1352-1607)
  - Combat action handlers for both enemy and character (lines ~1631-1851)
  - Save/load serialization and deserialization (lines ~3310-4937)
  - Reward processing (lines ~2261-2567)
  - Crafting/recipe execution (lines ~2653-2999)
  - Game option handlers (lines ~314-577)
  - Location management and travel (lines ~585-656)
  - Activity management (lines ~673-717)
  - Action system (lines ~747-911)
  - Health/stamina management (lines ~992-1059)
  - XP and skill leveling (lines ~1942-2185)
  - Book reading system
  - Sleeping/resting system
  - Global state declarations (lines ~113-290)
  - Window global assignments (lines ~5546-5654)
- **Suggested Refactor**: Extract into at least 8 focused modules:
  - `combat_manager.js` - combat loop, attack actions, damage calculation
  - `save_manager.js` - serialization, deserialization, version compatibility
  - `reward_manager.js` - reward processing
  - `crafting_manager.js` - recipe execution
  - `option_manager.js` - game options handlers
  - `activity_manager.js` - activities, resting, sleeping, reading
  - `xp_manager.js` - XP gain, skill leveling, milestone processing
  - `game_state.js` - centralized state container

#### HIGH: `display.js` Mixed Concerns
- **File**: `src/display.js` (~5,612 lines)
- **Severity**: High
- **Pattern**: This file handles ALL UI rendering -- inventory, combat, locations, skills, dialogues, trading, crafting, quests, weather effects, canvas particles, and more. It imports from virtually every other module. It serves as both a view layer and a controller layer.
- **Suggested Refactor**: Split into display modules by domain (e.g., `display_combat.js`, `display_inventory.js`, `display_skills.js`, etc.). Introduce a thin event bus so game logic modules emit events rather than calling display functions directly.

#### MEDIUM: `character.js` Monkey-Patching
- **File**: `src/character.js` (lines ~256-401)
- **Severity**: Medium
- **Pattern**: After the `Hero` class definition, functions like `character.stats.add_skill_milestone_bonus`, `character.stats.add_book_bonus`, `character.stats.add_active_effect_bonus`, and `character.stats.add_all_equipment_bonus` are monkey-patched onto the character singleton outside of the class. This makes the character object responsible for stat aggregation from skills, books, effects, and equipment -- all separate concerns.
- **Suggested Refactor**: Create a `StatCalculator` class or module that takes the character and various bonus sources as inputs and produces final stats. This decouples stat computation from the character entity itself.

### 2.2 Open/Closed Principle (OCP)

#### HIGH: Hardcoded Reward Types in `process_rewards()`
- **File**: `src/main.js` (lines ~2261-2567)
- **Severity**: High
- **Pattern**: The `process_rewards()` function is a ~300-line monolith with explicit `if` branches for every reward type (money, xp, skill_xp, locations, textlines, dialogues, traders, housing, crafting, activities, actions, stances, recipes, reputation, quests, quest_progress, locks, items, move_to, messages, global_activities, flags). Adding a new reward type requires modifying this function.
- **Suggested Refactor**: Implement a reward handler registry pattern where each reward type registers a handler function. `process_rewards()` would iterate the rewards object and dispatch to the appropriate registered handler.

#### HIGH: Hardcoded Crafting Branches in `use_recipe()`
- **File**: `src/main.js` (lines ~2653-2999)
- **Severity**: High
- **Pattern**: The `use_recipe()` function has three near-identical code branches for "items", "components", and "equipment" recipe types (~100 lines each), with minor variations. Adding a new recipe type requires adding another branch.
- **Suggested Refactor**: Extract a base crafting flow with hooks/strategy pattern for the parts that differ (result generation, quality calculation, XP gain).

#### MEDIUM: Condition Checking in `process_conditions()`
- **File**: `src/conditions.js` (lines 57-180)
- **Severity**: Medium
- **Pattern**: Conditions checking has explicit branches for money, skills, hero_level, items_by_id, stats, season, tools_by_slot, reputation, and flags. Each new condition type requires modifying the function.
- **Suggested Refactor**: Use a condition handler map, where each condition type registers its own check function.

### 2.3 Liskov Substitution Principle (LSP)

#### LOW: Location vs Combat_zone vs Challenge_zone
- **File**: `src/locations.js`
- **Severity**: Low
- **Pattern**: `Location` and `Combat_zone` are separate classes that do not share a common base class, despite both being "locations" in the game. `Challenge_zone` extends `Combat_zone`. Code that handles locations often needs to check tags (`safe_zone`, `Combat zone`) to determine which type it is, rather than relying on polymorphism.
- **Suggested Refactor**: Introduce a common `BaseLocation` class with shared properties (name, id, description, temperature settings, connected_locations, is_unlocked, is_finished, tags). Have both `Location` and `Combat_zone` extend it.

### 2.4 Dependency Inversion Principle (DIP)

#### HIGH: Circular and Concrete Dependencies
- **File**: Multiple files
- **Severity**: High
- **Pattern**: Modules directly import concrete singletons from each other. For example:
  - `display.js` imports ~100 symbols from `main.js`
  - `main.js` imports from `display.js`
  - `character.js` imports from `main.js` and vice versa
  - `locations.js` imports from `main.js` (`global_flags`)
  - `quests.js` imports `process_rewards` from `main.js`

  This creates a tightly coupled dependency web where almost everything depends on `main.js` and `main.js` depends on almost everything.
- **Suggested Refactor**: Introduce an event bus or mediator pattern. Game logic modules should emit events (e.g., "enemy_killed", "skill_leveled") and listener modules react to them, rather than importing and calling functions across module boundaries.

---

## 3. DRY Violations

### 3.1 Save/Load Inventory Deserialization (3x Duplication)

- **File**: `src/main.js` (within `load()`, lines ~3631-4937)
- **Severity**: Critical
- **Pattern**: The inventory loading logic is repeated nearly identically three times for:
  1. Character inventory
  2. Player storage inventory
  3. Each trader's inventory

  Each instance iterates over saved inventory data, reconstructs items using `getItem()`, and inserts them into an inventory object. The logic is essentially the same with minor variable name changes.
- **Suggested Refactor**: Extract a `deserialize_inventory(saved_data)` function that returns a reconstructed inventory object. Call it three times with different inputs.

### 3.2 Option Handler Functions (15+ Near-Identical Copies)

- **File**: `src/main.js` (lines ~314-577)
- **Severity**: High
- **Pattern**: Functions like `option_combat_autoswitch_handler()`, `option_remember_stance_handler()`, `option_uniform_textsize_handler()`, etc. all follow the exact same pattern:
  ```javascript
  function option_X_handler() {
      game_options.X = !game_options.X;
      if(game_options.X) {
          // enable CSS or behavior
      } else {
          // disable CSS or behavior
      }
  }
  ```
  This pattern is repeated 15+ times with minimal variation.
- **Suggested Refactor**: Create a generic `create_option_handler({option_key, on_enable, on_disable})` factory function. Define each option as a configuration object rather than a separate function.

### 3.3 Stat Bonus Aggregation Functions (4x Duplication)

- **File**: `src/character.js` (lines ~256-401)
- **Severity**: High
- **Pattern**: The following functions are near-identical:
  - `character.stats.add_skill_milestone_bonus()` (lines ~256-287)
  - `character.stats.add_book_bonus()` (lines ~294-316)
  - `character.stats.add_active_effect_bonus()` (lines ~318-344)
  - `character.stats.add_all_equipment_bonus()` (lines ~350-401)

  All four iterate over a collection of bonus sources, check for `flat` and `multiplier` sub-properties, and accumulate them into `character.stats.flat` and `character.stats.multiplier` objects.
- **Suggested Refactor**: Extract a generic `aggregate_stat_bonuses(bonus_source_list, target_stats)` function. Each caller provides its specific source list (milestones, books, effects, equipment).

### 3.4 Combat Timer Correction Logic (2x Duplication)

- **File**: `src/main.js` (within combat loop, lines ~1352-1607)
- **Severity**: Medium
- **Pattern**: The timer variance accumulation and correction logic for smooth tick timing is duplicated between `enemy_combat_loop()` and `character_combat_loop()`. Both calculate `timer_expected`, `timer_actual`, `timer_variance_accumulator`, and adjust the next timeout accordingly.
- **Suggested Refactor**: Extract a `CombatTimer` class or utility function that encapsulates the self-correcting setTimeout loop pattern.

### 3.5 Resting and Sleeping Logic (2x Duplication)

- **File**: `src/main.js` (lines ~1022-1059)
- **Severity**: Medium
- **Pattern**: `do_resting()` and `do_sleeping()` both contain stamina restoration logic that is structurally identical, differing only in the XP source and restoration rates.
- **Suggested Refactor**: Extract a `restore_stamina({rate, xp_source, xp_rate})` helper.

### 3.6 Combat Action Handlers (2x Parallel Structure)

- **File**: `src/main.js` (lines ~1631-1851)
- **Severity**: Medium
- **Pattern**: `do_enemy_combat_action()` and `do_character_combat_action()` follow the same structural pattern: calculate hit chance, determine if hit lands, calculate damage, apply damage, check for death, handle loot/rewards. The enemy version and character version share significant structural duplication.
- **Suggested Refactor**: Create a generic `resolve_attack({attacker, defender, on_hit, on_miss, on_kill})` function parameterized by attacker/defender roles.

### 3.7 Rarity Calculation (2x Duplication)

- **File**: `src/items.js`
- **Severity**: Low
- **Pattern**: `getItemRarity()` function (lines ~121-132) and `ItemComponent.calculateRarity()` method contain duplicate logic for mapping quality values to rarity strings.
- **Suggested Refactor**: Have `ItemComponent.calculateRarity()` delegate to `getItemRarity()`.

### 3.8 Armor Slot Determination (2x Duplication)

- **File**: `src/items.js`
- **Severity**: Low
- **Pattern**: `getArmorSlot()` function (lines ~102-119) duplicates slot determination logic that also appears in the `Armor` constructor (lines ~700-757).
- **Suggested Refactor**: Have the `Armor` constructor call `getArmorSlot()` instead of reimplementing the logic.

---

## 4. Technical Debt

### 4.1 Global Mutable State

- **File**: `src/main.js` (lines ~113-290)
- **Severity**: Critical
- **Pattern**: Dozens of module-level mutable variables are exported and freely mutated from other modules:
  ```javascript
  let current_enemies;
  let current_location;
  let active_effects = {};
  let is_sleeping, is_resting, is_reading;
  let current_enemy_index, enemy_attack_loop, character_attack_loop;
  let game_options = { /* ~30 fields */ };
  let global_flags = {};
  let faved_stances, selected_stance;
  let favourite_consumables, favourite_items;
  let unlocked_beds;
  let travel_times;
  let language;
  // ... and more
  ```
  Any module can import and mutate these at any time, making it extremely difficult to reason about state changes or track down bugs.
- **Suggested Refactor**: Consolidate into a `GameState` class with controlled access methods. Emit state change events when values are modified.

### 4.2 Window Global Assignments

- **File**: `src/main.js` (lines ~5546-5654)
- **Severity**: High
- **Pattern**: Over 50 functions are assigned to `window.*` to make them accessible from HTML onclick handlers:
  ```javascript
  window.start_activity = start_activity;
  window.change_location = change_location;
  window.equip_item = equip_item;
  // ... 50+ more
  ```
  This pollutes the global namespace, makes it impossible to tree-shake unused code, and creates an implicit API contract.
- **Suggested Refactor**: Use `addEventListener` to attach event handlers from JavaScript rather than inline `onclick` attributes in HTML. This eliminates the need for `window.*` assignments.

### 4.3 Magic Numbers

- **File**: Multiple files
- **Severity**: Medium
- **Examples**:
  - `src/main.js`: `if(character.stats.full.stamina >= 1)` -- stamina threshold
  - `src/main.js`: `Math.round(1.01 ** current_level * ...)` -- XP scaling factor `1.01`
  - `src/main.js`: `0.015` -- money loss on death percentage
  - `src/misc.js`: Hit chance breakpoints (`0.80`, `0.70`, `0.60`, etc.) with hardcoded polynomial coefficients (`0.971`, `0.846`, `0.688`, etc.)
  - `src/locations.js`: Enemy group size limits (`1` to `8`)
  - `src/market_saturation.js`: Saturation caps (`500`, `200`), parameters (`capped_at/9`)
  - `src/pathfinding.js`: `max_modifier_from_skill = 4`
  - `src/character.js`: Various stat calculation constants
- **Suggested Refactor**: Extract game balance constants into a centralized `constants.js` or `balance_config.js` file with descriptive names.

### 4.4 Inconsistent Naming and Typos

- **Severity**: Medium
- **Examples**:
  - `ammount` (should be `amount`) -- appears in `src/main.js`, `src/locations.js`, `src/crafting_recipes.js`, `src/traders.js`
  - `update_health(ammount)` in `src/main.js` line ~992
  - `enemy_abilites` (should be `enemy_abilities`) in `src/enemies.js` line ~126
  - Mixed naming conventions: `is_unlocked` vs `isQuestActive`, `enemy_groups_killed` vs `getCompletedTaskCount`, `get_total_effect` vs `getProfitMargin`
  - `PriorityQueue` uses `add_to_queue`/`shift_from_queue` (snake_case methods on PascalCase class)
  - `Game_Time` constructor function (not a class) uses PascalCase with underscore
  - `LocationActivity` vs `GameAction` vs `Combat_zone` -- inconsistent class naming conventions

### 4.5 Missing Error Handling

- **File**: Multiple files
- **Severity**: Medium
- **Pattern**: Many functions perform no input validation or error handling:
  - `load()` in `src/main.js` has try/catch around the entire function but catches everything silently with just a console.error
  - `process_rewards()` does not validate reward structure
  - `use_recipe()` does not validate recipe existence before accessing properties
  - `get_hit_chance()` in `src/misc.js` returns `0` for ratios below 0.10 with no warning
  - Market saturation functions assume region/group keys exist without null checks
- **Suggested Refactor**: Add validation at module boundaries, particularly in `load()` and `process_rewards()`.

### 4.6 Dead/Commented-Out Code

- **File**: Multiple files
- **Severity**: Low
- **Examples**:
  - `src/traders.js` (lines ~120-131): Entire `getItemPrice` method commented out
  - `src/quests.js` (lines ~493-525): Test quest definition commented out
  - `src/crafting_recipes.js`: Commented-out `scales_with_skill` property references
  - `src/market_saturation.js`: Commented-out loop versions in `get_loot_price_multiple()`
  - `src/display.js` (line 26): `//import { stances } from "./combat_stances.js";`
  - `src/verifier.js`: Commented-out item stat verification block

### 4.7 `Game_Time` is a Constructor Function, Not a Class

- **File**: `src/game_time.js` (lines 3-108)
- **Severity**: Low
- **Pattern**: `Game_Time` uses the old-style constructor function pattern with `this.method = function()` assignments and `Game_Time.prototype.toString`. Every other entity in the codebase uses ES6 `class` syntax. This is inconsistent and means instance methods are recreated for every instance rather than shared via prototype.
- **Suggested Refactor**: Convert to ES6 `class` syntax for consistency.

### 4.8 Tight Coupling Between Game Logic and Display

- **File**: `src/main.js`, `src/display.js`
- **Severity**: High
- **Pattern**: Game logic functions in `main.js` directly call display functions (e.g., `log_message()`, `update_displayed_health()`, `update_displayed_enemies()`) inline within game logic. This means game logic cannot run without the display module (e.g., for testing or headless operation).
- **Suggested Refactor**: Have game logic emit events. Display module subscribes to those events and updates the UI. This decouples logic from presentation.

---

## 5. Data Architecture Issues

### 5.1 Definitions Mixed with Logic

- **Severity**: Critical
- **Files Affected**:
  - `src/enemies.js`: `Enemy` class + ~400 lines of enemy definitions
  - `src/locations.js`: `Location`/`Combat_zone`/`Challenge_zone` classes + ~2,400 lines of location definitions
  - `src/skills.js`: `Skill` class + ~2,800 lines of skill definitions with milestones
  - `src/items.js`: 10+ item classes + ~3,700 lines of item template definitions
  - `src/active_effects.js`: `ActiveEffect` class + ~350 lines of effect definitions
  - `src/activities.js`: `Activity`/`Job`/`Training`/`Gathering` classes + ~130 lines of definitions
  - `src/combat_stances.js`: `Stance` class + ~80 lines of stance definitions
  - `src/dialogues.js`: `Dialogue`/`Textline`/`DialogueAction` classes + ~1,700 lines of dialogue content
  - `src/crafting_recipes.js`: `Recipe`/`ItemRecipe`/`ComponentRecipe` classes + ~1,500 lines of recipe definitions
  - `src/traders.js`: `Trader`/`TradeItem` classes + ~300 lines of trader/inventory definitions
  - `src/translation.js`: `translationManager` + ~600 lines of translation strings

- **Pattern**: In nearly every file, class/logic definitions and content data live in the same module. This means:
  - Changing a wolf's stats requires editing the same file that defines the `Enemy` class
  - Adding a new location means modifying a file that also contains pathfinding-related logic
  - Content creators must understand the code to add content
  - Files grow unboundedly as content is added

- **Suggested Refactor**: Separate into `*_definitions.js` or `data/*.js` files that export pure data objects:
  - `data/enemies.json` or `data/enemy_definitions.js`
  - `data/locations_definitions.js`
  - `data/skill_definitions.js`
  - `data/item_definitions.js`
  - etc.

  The class files then import and instantiate from these data files.

### 5.2 Save/Load Fragility and Version Compatibility Burden

- **File**: `src/main.js` (lines ~3631-4937, `load()` function, ~1,300 lines)
- **Severity**: Critical
- **Pattern**: The `load()` function contains an enormous chain of version-specific migration blocks:
  ```javascript
  if(is_a_older_than_b(save_version, "0.3.1")) { /* migration */ }
  if(is_a_older_than_b(save_version, "0.3.2")) { /* migration */ }
  // ... repeated for dozens of versions through 0.5.1.10
  ```
  Each version bump may add new fields with defaults, rename properties, restructure data, or migrate inventory formats. This is extremely brittle because:
  - Migrations are not tested in isolation
  - The function must handle saves from any historical version
  - A single bug in a migration can corrupt save data
  - The function is nearly impossible to read or maintain

- **Suggested Refactor**:
  1. Define save format as a schema with a version number
  2. Implement migrations as discrete, testable functions: `migrate_0_3_1_to_0_3_2(save_data)`
  3. Chain migrations sequentially: find current version, apply all migrations up to current
  4. Store migration functions in a separate `migrations/` directory

### 5.3 String-Based Key References

- **Severity**: High
- **Pattern**: The entire codebase uses string literals as keys for cross-referencing entities:
  - `locations["Village"]`, `traders["village trader"]`, `dialogues["village elder"]`
  - Reward objects reference locations, dialogues, quests, skills, items all by string name
  - Typos in string keys cause silent failures (e.g., referencing a nonexistent location)

  The `verifier.js` module partially addresses this by checking for mismatches at startup, but this is a runtime-only safety net.

- **Suggested Refactor**: Use an ID constant system or TypeScript enums to catch key mismatches at build time. At minimum, freeze key objects after creation so new invalid keys cause errors.

### 5.4 Inventory Key System

- **File**: `src/items.js`, `src/inventory.js`
- **Severity**: Medium
- **Pattern**: Items are stored in inventories using a JSON-stringified key:
  ```javascript
  getInventoryKey() {
      return JSON.stringify({id: this.id, quality: this.quality});
  }
  ```
  This means:
  - Every inventory lookup requires JSON.stringify
  - Key format is implicit and fragile
  - Items with same id but different quality are different inventory entries
  - Parsing keys requires JSON.parse (seen in `conditions.js` line 109)

- **Suggested Refactor**: Use a composite key string format (e.g., `"item_id:quality"`) or use a Map with proper key objects.

### 5.5 State Management Race Conditions in Combat

- **File**: `src/main.js` (combat loop area)
- **Severity**: Medium
- **Pattern**: Combat uses two independent `setTimeout` loops -- one for the character and one for enemies. Both modify shared state (`current_enemies`, character health, etc.) without synchronization. While JavaScript is single-threaded, the interleaving of timeout callbacks can lead to stale state reads (e.g., attacking an enemy that was already killed by another concurrent timeout).
- **Suggested Refactor**: Use a single combat tick loop with ordered resolution (character attacks first, then enemies, or vice versa based on speed).

---

## 6. Refactoring Opportunities

### 6.1 Extract `SaveManager` Module

- **Priority**: Critical
- **Effort**: High
- **Impact**: Dramatically improves maintainability of the most complex part of the codebase
- **Details**:
  - Extract `create_save()` and `load()` from `main.js` into `save_manager.js`
  - Extract version migrations into individual functions in a `migrations/` directory
  - Extract inventory serialization/deserialization into reusable helpers
  - Define a save schema interface so changes are explicit

### 6.2 Extract `CombatManager` Module

- **Priority**: High
- **Effort**: Medium
- **Impact**: Removes ~500 lines from `main.js`, enables isolated combat testing
- **Details**:
  - Move combat loop logic, attack resolution, damage calculation
  - Consolidate the duplicated timer correction logic
  - Consolidate `do_enemy_combat_action` and `do_character_combat_action` into a parameterized attack resolver
  - Expose a clean API: `start_combat()`, `end_combat()`, `pause_combat()`

### 6.3 Extract `RewardProcessor` with Handler Registry

- **Priority**: High
- **Effort**: Medium
- **Impact**: Makes reward system extensible, removes 300-line monolith
- **Details**:
  ```javascript
  // Conceptual approach
  const reward_handlers = {
      money: (value) => { character.money += value; },
      xp: (value) => { add_xp_to_hero(value); },
      locations: (value) => { value.forEach(loc => unlock_location(loc)); },
      // ... register handlers for each type
  };

  function process_rewards({rewards, ...context}) {
      Object.entries(rewards).forEach(([type, value]) => {
          if(reward_handlers[type]) reward_handlers[type](value, context);
      });
  }
  ```

### 6.4 Introduce Event Bus / Mediator

- **Priority**: High
- **Effort**: High
- **Impact**: Breaks circular dependencies, decouples logic from display
- **Details**:
  - Create a simple `EventBus` class with `emit(event, data)` and `on(event, handler)`
  - Game logic modules emit events: `"enemy_killed"`, `"skill_leveled"`, `"item_gained"`, `"location_changed"`
  - Display module and quest system subscribe to relevant events
  - Eliminates the need for `main.js` to import 100+ display functions

### 6.5 Separate Data Definitions from Logic

- **Priority**: High
- **Effort**: Medium
- **Impact**: Enables content-driven development, reduces file sizes dramatically
- **Details**: Create a `data/` directory with pure data files:
  - `data/enemies.js` - enemy template definitions
  - `data/locations.js` - location definitions with connections
  - `data/items.js` - item template definitions
  - `data/skills.js` - skill definitions with milestones
  - `data/recipes.js` - crafting recipe definitions
  - `data/dialogues.js` - dialogue trees and translation text

  Logic files import from data files:
  ```javascript
  // enemies.js (logic only)
  import { enemy_data } from "./data/enemies.js";
  const enemy_templates = {};
  Object.entries(enemy_data).forEach(([key, data]) => {
      enemy_templates[key] = new Enemy(data);
  });
  ```

### 6.6 Configuration-Driven Option Handlers

- **Priority**: Medium
- **Effort**: Low
- **Impact**: Eliminates ~250 lines of duplicated code in option handlers
- **Details**:
  ```javascript
  const option_configs = [
      { key: "combat_autoswitch", css_class: null, on_enable: null, on_disable: null },
      { key: "uniform_textsize", css_class: "uniform_textsize_enabled", target: document.body },
      { key: "dark_mode", css_class: "dark_mode_enabled", target: document.documentElement },
      // ... etc
  ];

  function create_option_handler(config) {
      return function() {
          game_options[config.key] = !game_options[config.key];
          if(config.css_class) {
              config.target.classList.toggle(config.css_class, game_options[config.key]);
          }
          if(config.on_enable && game_options[config.key]) config.on_enable();
          if(config.on_disable && !game_options[config.key]) config.on_disable();
      };
  }
  ```

### 6.7 Generic Stat Bonus Aggregator

- **Priority**: Medium
- **Effort**: Low
- **Impact**: Eliminates ~150 lines of duplicated stat aggregation code
- **Details**:
  ```javascript
  function aggregate_bonuses(sources, target_flat, target_multiplier) {
      for (const source of sources) {
          Object.entries(source).forEach(([stat, modifiers]) => {
              if (modifiers.flat) target_flat[stat] = (target_flat[stat] || 0) + modifiers.flat;
              if (modifiers.multiplier) target_multiplier[stat] = (target_multiplier[stat] || 1) * modifiers.multiplier;
          });
      }
  }
  ```

### 6.8 Convert `Location` / `Combat_zone` to Shared Base Class

- **Priority**: Low
- **Effort**: Medium
- **Impact**: Cleaner polymorphism, reduces tag-checking code
- **Details**: Both classes share 10+ identical properties (name, id, description, is_unlocked, is_finished, tags, temperature settings, etc.). A `BaseLocation` class would hold these, with `SafeLocation` adding dialogues/traders/crafting and `CombatLocation` adding enemy lists/rewards.

---

## 7. Priority Matrix

### Critical Priority (Address First)
| Issue | File(s) | Lines | Impact |
|-------|---------|-------|--------|
| `main.js` god file | `src/main.js` | 5,787 | Blocks all other refactoring |
| Save/load fragility | `src/main.js` | ~1,300 | Data corruption risk |
| Global mutable state | `src/main.js` | ~113-290 | Hard to debug, untestable |
| Data definitions mixed with logic | All entity files | ~8,000+ | Unbounded file growth |

### High Priority (Address Next)
| Issue | File(s) | Lines | Impact |
|-------|---------|-------|--------|
| `process_rewards()` monolith | `src/main.js` | ~300 | Hard to extend |
| `use_recipe()` branch duplication | `src/main.js` | ~350 | Hard to extend |
| Circular module dependencies | All files | N/A | Prevents clean module extraction |
| `display.js` monolith | `src/display.js` | 5,612 | Tight coupling to logic |
| `window.*` global assignments | `src/main.js` | ~100 | Global namespace pollution |
| Save/load inventory 3x duplication | `src/main.js` | ~300 | Maintenance burden |
| Stat bonus aggregation 4x duplication | `src/character.js` | ~150 | Maintenance burden |

### Medium Priority (Quality of Life)
| Issue | File(s) | Lines | Impact |
|-------|---------|-------|--------|
| Option handler duplication (15x) | `src/main.js` | ~250 | Bloat |
| Combat timer duplication | `src/main.js` | ~60 | Minor maintenance |
| Resting/sleeping duplication | `src/main.js` | ~40 | Minor maintenance |
| Magic numbers | Multiple | Scattered | Readability |
| Naming inconsistencies / typos | Multiple | Scattered | Readability |
| Missing error handling | Multiple | Scattered | Debugging difficulty |
| Inventory key system (JSON.stringify) | `src/items.js` | ~10 | Performance, fragility |
| `process_conditions()` extensibility | `src/conditions.js` | ~120 | Hard to extend |

### Low Priority (Nice to Have)
| Issue | File(s) | Lines | Impact |
|-------|---------|-------|--------|
| `Game_Time` constructor function style | `src/game_time.js` | ~108 | Consistency |
| Dead/commented-out code | Multiple | ~80 | Clutter |
| Rarity calculation duplication | `src/items.js` | ~20 | Minor duplication |
| Armor slot determination duplication | `src/items.js` | ~30 | Minor duplication |
| Location class hierarchy | `src/locations.js` | N/A | Minor architectural concern |

---

## Appendix: File Size Summary

| File | Lines | Primary Concerns |
|------|-------|-----------------|
| `src/main.js` | 5,787 | God file, save/load, combat, rewards, crafting, options |
| `src/display.js` | 5,612 | All UI rendering, tightly coupled |
| `src/items.js` | 4,716 | 10+ classes + all item definitions |
| `src/locations.js` | 3,414 | 4 classes + all location definitions |
| `src/skills.js` | 3,232 | Skill class + all skill definitions |
| `src/dialogues.js` | 2,094 | Dialogue classes + all dialogue content |
| `src/crafting_recipes.js` | 1,713 | Recipe classes + all recipe definitions |
| `src/character.js` | 908 | Hero class + monkey-patched stat methods |
| `src/translation.js` | 624 | Translation strings |
| `src/enemies.js` | 585 | Enemy class + all enemy definitions |
| `src/trade.js` | 566 | Trading logic |
| `src/verifier.js` | 515 | Startup validation |
| `src/quests.js` | 530 | Quest system + quest definitions |
| `src/traders.js` | 477 | Trader class + inventory templates |
| `src/active_effects.js` | 390 | Effect class + effect definitions |
| `src/market_saturation.js` | 303 | Market economy system |
| `src/activities.js` | 200 | Activity classes + definitions |
| `src/weather.js` | 201 | Temperature calculation |
| `src/game_time.js` | 187 | Time system |
| `src/conditions.js` | 185 | Condition evaluation |
| `src/pathfinding.js` | 154 | Dijkstra pathfinding |
| `src/combat_stances.js` | 152 | Stance class + definitions |
| `src/actions.js` | 107 | GameAction class |
| `src/rewards.js` | 121 | Documentation only (no code) |
| `src/inventory.js` | 82 | InventoryHaver base class |
| `src/storage.js` | 64 | Player storage wrapper |
| `src/reputation.js` | 23 | Reputation manager stub |
| `src/misc.js` | 239 | Utility functions |
