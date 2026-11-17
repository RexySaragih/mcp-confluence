const ELEMENT_NODE = 1;

export function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

export function childElements(node: Node): Element[] {
  return Array.from(node.childNodes).filter(isElement);
}

export function firstChildNamed(node: Node, localName: string): Element | undefined {
  return childElements(node).find((child) => child.localName === localName);
}

export function descendantNamed(node: Node, localName: string): Element | undefined {
  for (const child of childElements(node)) {
    if (child.localName === localName) return child;
    const nested = descendantNamed(child, localName);
    if (nested) return nested;
  }
  return undefined;
}

export function textOf(node: Node | undefined): string {
  return node?.textContent?.trim() ?? '';
}

export function replaceWithNodes(target: Element, nodes: Node[]): void {
  const parent = target.parentNode;
  if (!parent) return;
  const fragment = target.ownerDocument.createDocumentFragment();
  for (const node of nodes) fragment.appendChild(node);
  parent.replaceChild(fragment, target);
}

export function createElement(
  doc: Document,
  tagName: string,
  attributes: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElement {
  const element = doc.createElement(tagName);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  for (const child of children) {
    element.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
  }
  return element;
}
