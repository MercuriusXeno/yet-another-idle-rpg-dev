// class for handling document and element appends in a way that's *supposedly* safer than innerHtml +=
// experimental, until proven otherwise. - merc
export function clear(el) {
    el.replaceChildren();
}

// experiment with divs instead of breaks for line logic, tends to be better at composition anyway?
// if you have to, you can do this instead (use append() with a real BR node, doesn't parse or rebuild subtree)
// tooltip.append(
//   document.createElement('br'), ...);

export function node(type, text, ...cssClasses) {
    const node = document.createElement(type);
    cssClasses && node.classList.add(...cssClasses);
    node.textContent = text ?? '';
    return node;
}

export function addNode(el, node) { el.appendChild(node); }

export function addNodes(el, ...nodes) { nodes.forEach(node => addNode(el, node)); }

export function div(text, ...cssClasses) { return node('div', text, cssClasses); }

export function span(text, ...cssClasses) { return node('span', text, cssClasses); }

export function icon(text, ...cssClasses) { return node('i', text, cssClasses); }

/// i am lazy - merc
export function materialIcon(text, ...cssClasses) { return icon(text, ['material-icons', ...cssClasses]); }

export function addDiv(el, text, ...cssClasses) { addNode(el, div(text, cssClasses)); }

export function addSpan(el, text, ...cssClasses) { addNode(el, span(text, cssClasses)); }

export function addIcon(el, text, ...cssClasses) { addNode(el, icon(text, cssClasses)); }