// class for handling document and element appends in a way that's *supposedly* safer than innerHtml +=
// experimental, until proven otherwise. - merc


/**
 * Replace the element's children with nothing. This clears the dom node of any children added previously.
 * @param  {HTMLElement} el the element being unburdened of its children.
 */
export function clear(el) {
    el.replaceChildren();
}

// experiment with divs instead of breaks for line logic, tends to be better at composition anyway?
// if you have to, you can do this instead (use append() with a real BR node, doesn't parse or rebuild subtree)
// tooltip.append(
//   document.createElement('br'), ...);

/**
 * Create a single node of the requested type with the requested inner/content text and classes provided.
 * @param  {string} type the type of element to create on the dom
 * @param  {string?} text the inner text or text content of the element, if applicable
 * @param  {...string} cssClasses the class or classes to add to the element's css clast list, if applicable
 */
function node(type, text, ...cssClasses) {
    const node = document.createElement(type);
    cssClasses && cssClasses.length > 0 && node.classList.add(...cssClasses);
    node.textContent = text ?? ''; // fighting browser compat
    node.innerText = text ?? ''; // fighting browser compat
    return node;
}

/**
 * Clears the element's children before adding the selected nodes to its children.
 * @param  {HTMLElement} el the root node we are clearing, then adding elements, as children, to.
 * @param  {...HTMLElement} nodes a collection of nodes being added to the element provided.
 */
export function setNodes(el, ...nodes) {
    clear(el);
    addNodes(el, ...nodes);
}

/**
 * Adds a single node to the parent element provided. We don't expose this one
 * because it's the same signature as addNodes, there's no reason to expose both. 
 * @param  {HTMLElement} el the root node we are adding elements, as children, to.
 * @param  {HTMLElement} node a node we're adding to the provided element.
 */
function addNode(el, node) {
    // this is a safety thing, but it also makes style-less spans brainless
    // so let's call it a feature? This lets you throw strings at addNode.
    // It doesn't work if you want styles but it's great for inlining otherwise.
    if (typeof node === 'string') {
        node = span(node);
    }
    try {
        el.appendChild(node);
    } catch (error) {
        el.append(node);
    }
}

/**
 * Adds the nodes in the collection to a parent node stepwise. See {@link addNode} for implementation specifics.
 * @param  {HTMLElement} el the root node we are adding elements, as children, to.
 * @param  {...HTMLElement} nodes a collection of nodes being added to the element
 * @returns {HTMLElement} Returns the root node being modified, in case it was created inline.
 */
export function addNodes(el, ...nodes) { 
    nodes.forEach(node => addNode(el, node)); 
    return el;
}

/**
 * A div around a body of text, with the selected css classes.
 * @param  {string?} text the inner text or text content of the element, if applicable
 * @param  {...string} cssClasses the class or classes to add to the element's css clast list, if applicable
 * @returns the requested div.
 */
export function div(text, ...cssClasses) { return node('div', text, ...cssClasses); }

/**
 * A span around a body of text, with the selected css classes.
 * @param  {string?} text the inner text or text content of the element, if applicable
 * @param  {...string} cssClasses the class or classes to add to the element's css clast list, if applicable
 * @returns the requested span.
 */
export function span(text, ...cssClasses) { return node('span', text, ...cssClasses); }

/**
 * A body of text wrapped in bold tags, with the selected styles.
 * @param {string?} text the inner text of the element, if applicable.
 * @param  {...string} cssClasses the css styles of the bold element, if applicable
 * @returns the requested text, in bold.
 */
export function bold(text, ...cssClasses) { return node('b', text, ...cssClasses); }

/**
 * An icon element with the selected text and classes.
 * @param  {string?} text the inner text of the icon; this controls the icon itself, typically.
 * @param  {...string} cssClasses the class or classes to add to the element's css clast list, if applicable
 * @returns the requested icon.
 */
export function icon(text, ...cssClasses) { return node('i', text, ...cssClasses); }

/**
 * A break element.
 * @returns a break element node.
 */
export function br() { return node('br', ''); }

/**
 * Create an icon already classed as a material icon, and inserts its inner text to select which icon.
 * @param  {string?} text the inner text of the icon; this controls the icon itself, typically.
 * @param  {...string} cssClasses the css styles of the icon, if applicable
 * @returns an icon styled as the selected material icon.
 */
export function materialIcon(text, ...cssClasses) { return icon(text, 'material-icons', ...cssClasses); }

/**
 * Create an icon for travel locations.
 * @returns an icon styled as the travel location icon.
 */
function choiceIcon() { return materialIcon("check_box_outline_blank", 'location_choice_icon'); }

/**
 * Create an icon for the combat locations with a little warning sign.
 * @returns an icon styled as the combat location icon.
 */
function combatIcon() { return materialIcon("warning_amber"); }

/**
 * Create a box around a provided icon and its respective label, styled as directed.
 * @param  {HTMLElement} iconNode the node (expects an icon node) we're using for the icon box
 * @returns a div containing an icon and span, styled as directed
 */
export function iconBox(iconNode) {
    let choiceBox = div("", "location_choice_icon_box");
    addNodes(choiceBox, iconNode);
    return choiceBox;
}

/**
 * Create a choice box around a standard "location choice" icon and its respective label, styled as directed.
 * @param {string?} text the inner text of the choice, if applicable
 * @param  {...string} cssClasses the css styles of the inner span, if applicable
 * @returns a div containing the choice icon and span, styled as directed
 */
export function choiceBox(text, ...cssClasses) { return [iconBox(choiceIcon()), span(' '),span(text, ...cssClasses)]; }

/**
 * Create a choice box around a standard "combat location" icon and its respective label, styled as directed.
 * @param {string?} text the inner text of the choice, if applicable
 * @param  {...string} cssClasses the css styles of the inner span, if applicable
 * @returns a div containing the combat icon and span, styled as directed
 */
export function combatBox(text, ...cssClasses) { return [iconBox(combatIcon()), span(' '), span(text, ...cssClasses)]; }

/**
 * Create an array containing 1) an icon for location choice and 2) the label of the location, styled as directed.
 * @param {string?} text the inner text of the choice, if applicable
 * @param  {...string} cssClasses the css styles of the inner span, if applicable
 * @returns a div containing the combat icon and span, styled as directed
 */
export function choice(text, ...cssClasses) { return [choiceIcon(), span(' '),span(text, ...cssClasses)] }

/**
 * Create an array containing 1) an icon for location combat and 2) the label of the location, styled as directed.
 * @param {string?} text the inner text of the choice, if applicable
 * @param  {...any} cssClasses the css styles of the inner span, if applicable
 * @returns a div containing the combat icon and span, styled as directed
 */
export function combat(text, ...cssClasses) { return [combatIcon(), span(' '), span(text, ...cssClasses)] };