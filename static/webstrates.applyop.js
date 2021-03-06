/*
Webstrates ApplyOp (webstrates.applyop.js)

This module exposes the applyOp(op, rootElement) function on the Webstrates scope. This function
applies a subset of json0 OT operations (see https://github.com/ottypes/json0) to a DOM element.
The operations handled are list insertion and deletion (li and ld), as well as string insertion and
deletion (si and sd). These operations are generated on another client using the CreateOp module.
*/
var root = typeof module === "object" && module.exports ? module.exports : window;

root.webstrates = (function(webstrates) {
	"use strict";

	var jsonml = {
		TAG_NAME_INDEX: 0,
		ATTRIBUTE_INDEX: 1,
		ELEMENT_LIST_OFFSET: 2
	};

	/**
	 * Extract the XML namespace from a DOM element.
	 * @param  {DOMNode} element Element.
	 * @return {string}          Namespace string.
	 * @private
	 */
	var getNamespace = function(element) {
		if (!element || !element.getAttribute) {
			return undefined;
		}

		var namespace = element.getAttribute("xmlns");

		return namespace ? namespace : getNamespace(element.parent);
	};

	/**
	 * Recursively navigates an element using path to set the value as an attribute.
	 * @param {DOMNode} rootElement   DOMNode used as root element for path navigation.
	 * @param {DOMPath} path          Path to follow on DOMNode. Last element of path is the attribute
	 *                                key.
	 * @param {string} value          Attribute value.
	 * @private
	 */
	var setAttribute = function(rootElement, path, attributeName, newValue) {
		var [childElement, ] = webstrates.PathTree.elementAtPath(rootElement, path);

		var isSvgPath = childElement.tagName.toLowerCase() === "path" && attributeName === "d";
		if (isSvgPath) childElement.__d = newValue;

		var oldValue = childElement.getAttribute(attributeName);
		childElement.setAttribute(attributeName, newValue);

		childElement.webstrate.fireEvent("attributeChanged", attributeName, oldValue, newValue, false);
	};

	/**
	 * Recursively navigates an element using path to remove the attribute at the end of the path.
	 * @param {DOMNode} rootElement   DOMNode usf ed as root element for path navigation.
	 * @param {DOMPath} path          Path to fllow on DOMNode. Last element of path is the attribute
	 *                                key.
	 * @private
	 */
	var removeAttribute = function(rootElement, path, attributeName) {
		var [childElement, ] = webstrates.PathTree.elementAtPath(rootElement, path);
		var isSvgPath = childElement.tagName.toLowerCase() === "path" && attributeName === "d";
		if (isSvgPath) delete childElement.__d;
		var oldValue = childElement.getAttribute(attributeName);
		childElement.removeAttribute(attributeName);

		childElement.webstrate.fireEvent("attributeChanged", attributeName, oldValue, undefined, false);
	};

	/**
	 * Recursively navigates an element using path to insert an element.
	 * @param {DOMNode} rootElement   DOMNode used as root element for path navigation.
	 * @param {DOMPath} path          Path to follow on DOMNode.
	 * @param {mixed} value           Element to insert, either a text string or JQML element.
	 * @private
	 */
	var insertNode = function(rootElement, path, value) {
		var [childElement, childIndex, parentElement] =
			webstrates.PathTree.elementAtPath(rootElement, path);

		var namespace = getNamespace(parentElement);
		var newElement = typeof value === 'string' ?
			document.createTextNode(value) : jqml(value, namespace);

		// childElement may be undefined, and if so we insert newElement at the end of the list. If
		// chidElement is defined, however, we insert the element before childElement.
		webstrates.util.appendChildWithoutScriptExecution(parentElement, newElement, childElement);

		var parentPathNode = webstrates.PathTree.getPathNode(parentElement);
		var childPathNode = webstrates.PathTree.create(newElement, parentPathNode);

		// childPathNode may not have been created, becuase its parent doesn't have a PathTree (because
		// its a descendent of a transient element, or a transient element itself) or because the new
		// element itself is a transient element.
		if (!childPathNode) {
			return;
		}

		// Insert new element into parent PathTree.
		parentPathNode.children.splice(childIndex, 0, childPathNode);

		// Notify nodeAdded listeners.
		parentElement.webstrate.fireEvent("nodeAdded", newElement, false);
	};

	/**
	 * Recursively navigates an element using path to delete an element.
	 * @param {DOMNode} rootElement   DOMNode used as root element for path navigation.
	 * @param {DOMPath} path          Path to follow on DOMNode.
	 * @private
	 */
	var deleteNode = function(rootElement, path) {
		var [childElement, childIndex, parentElement] =
			webstrates.PathTree.elementAtPath(rootElement, path);

		// Update PathTree to reflect the deletion.
		// TODO: Use PathTree.remove() instead.
		var parentPathNode = webstrates.PathTree.getPathNode(parentElement);
		var childPathNode = webstrates.PathTree.getPathNode(childElement, parentPathNode);
		parentPathNode.children.splice(childIndex, 1);

		// And remove the actual DOM node.
		childElement.remove();

		// Notify nodeRemoved listeners.
		parentElement.webstrate.fireEvent("nodeRemoved", childElement, false);
	};

	/**
	 * Replace a node, either a tag name, list of attributes or a regular node.
	 * Note that this is added for compatibility with a wider array of json0 operations such as those
	 * used by Webstrates file system. Webstrates itself does not create these kinds of operations.
	 * @param {DOMNode} rootElement   DOMNode used as root element for path navigation.
	 * @param {DOMPath} path          Path to follow on DOMNode.
	 * @param {mixed} value           Element to insert, new tag name, or new set of attributes.
	 * @private
	 */
	var replaceNode = function(rootElement, path, value) {
		var [childElement, childIndex, parentElement, indexType] =
			webstrates.PathTree.elementAtPath(rootElement, path);

		// Webstrates file system has some broken parsing, so it may think JavaScript like "< b)" in
		// "if (a < b)" is an element and try to send a replacement op. In this case, childElement
		// doesn't exist. This should be solved in Webstrates file system, but we'll fix it here, too.
		if (!childElement) {
			return;
		}

		switch (indexType) {
			// We're renaming a tag, e.g. when <span>foo</span> should become <div>foo</div>.
			case jsonml.TAG_NAME_INDEX:
				var oldElement = childElement;
				var namespace = getNamespace(oldElement);
				var newElement = jqml([value], namespace);

				var parentPathNode = webstrates.PathTree.getPathNode(parentElement);
				if (!parentPathNode) {
					console.warn("No parentPathNode found, aborting. This shouldn't happen, but...");
					return;
				}
				// Move all children.
				while (oldElement.firstChild) {
					webstrates.util.appendChildWithoutScriptExecution(newElement, oldElement.firstChild);
				}

				// Copy all attributes.
				for (var i = 0; i < oldElement.attributes.length; i++) {
					var attr = oldElement.attributes.item(i);
					var isSvgPath = childElement.tagName.toLowerCase() === "path" && attributeName === "d";
					if (isSvgPath) newElement.__d = attr.nodeValue;
					newElement.setAttribute(attr.nodeName, attr.nodeValue);
				}

				// Overwrite old node with new node.
				webstrates.util.appendChildWithoutScriptExecution(parentElement, newElement, oldElement);
				oldElement.remove();

				var newElementPathNode = webstrates.PathTree.create(newElement, parentPathNode, true);

				// New element may not have a PathNode if it's a transient object.
				if (!newElementPathNode) {
					break;
				}

				parentPathNode.children.splice(childIndex, 1, newElementPathNode);
				break;

			// We're replacing an entire object of attributes by writing all the new attributes and
			// deleting old ones.
			case jsonml.ATTRIBUTE_INDEX:
				var newAttributes = value;
				var oldAttributeKeys = Array.from(childElement.attributes).map(function(attribute) {
					return attribute.name;
				});

				var attributes = new Set([...Object.keys(newAttributes), ...oldAttributeKeys]);
				attributes.forEach(function(attributeName) {
					var isSvgPath = childElement.tagName.toLowerCase() === "path" && attributeName === "d";
					if (attributeName in newAttributes) {
						if (isSvgPath) childElement.__d = newAttributes[attributeName];
						childElement.setAttribute(attributeName, newAttributes[attributeName]);
					} else {
						if (isSvgPath) delete childElement.__d;
						childElement.removeAttribute(attributeName);
					}
				});
				break;

			// Otherwise, we're just replacing a regular node.
			default:
				deleteNode(rootElement, path);
				insertNode(rootElement, path, value)
				break;
			}
	};

	/**
	 * Get element with cursor/selection offset. Given a negative offset, traverse through the DOM
	 * tree to find the appropriate element.
	 * @param  {DOMNode} element    Element to traverse from
	 * @param  {Number} offset      Cursor/selection offset.
	 * @return {[element, offset]}  Touple containing new element and (positive) offset.
	 * @private
	 */
	function findOffsetElement(element, offset) {
		// If the offset is within this element, we can return.
		if (offset >= 0) return [ element, offset ];

		// Explore the previous sibling's children if has children.
		if (element.lastChild) {
			offset = element.lastChild.nodeType === document.TEXT_NODE
				? offset + element.lastChild.length : offset;
			return findOffsetElement(element.lastChild, offset);
		}

		if (!element.previousSibling) {
			// If he element isn't a text node and has no children, we move up the tree to explore the
			// parent node.
			offset = element.parentNode.nodeType === document.TEXT_NODE
				? offset + element.parentNode.length : offset;
			return findOffsetElement(element.parentNode, offset);
		}

		// Explore the previous sibling if it's a text node. This recursion will converge towards a
		// positive offset.
		if (element.previousSibling.nodeType === document.TEXT_NODE) {
			return findOffsetElement(element.previousSibling,
				offset + element.previousSibling.nodeValue.length);
		}
	}

	/**
	 * Find selection range in node if it exists.
	 * @param  {TextNode} textNode TextNode to look for Range in.
	 * @return {mixed}             Basic object containing the essential properties of a Range object.
	 * @private
	 */
	function getSelectionRange(textNode) {
		// If there are no selections, return.
		if (window.getSelection().rangeCount === 0) {
			return;
		}

		var realRange = window.getSelection().getRangeAt(0);
		// If selection isn't in this node, return.
		if (realRange.commonAncestorContainer !== textNode) {
			return;
		}

		// Finally, return the range. We can't return the original range, as it may change. Since the
		// range is already bound to the DOM, if we clone it, the cloned range will also be bound to the
		// DOM. If any changes are made to the involved TextNode, then the offsets will therefore be
		// set to 0. Therefore, we mange a basic object containing the essential properties of a real
		// Range object.
		var fakeRange = {
			startOffset: realRange.startOffset,
			startContainer: realRange.startContainer,
			endOffset: realRange.endOffset,
			endContainer: realRange.endContainer
		};
		return fakeRange;
	}

	/**
	 * Set selection on textnode based on fakeRange. Uses findOffsetElement to fix negative offsets.
	 * @param {TextNode} textNode  TextNode to base selection around.
	 * @param {mixed} fakeRange    Basic object containing the essential properties of a Range object.
	 * @private
	 */
	function setSelectionRange(textNode, fakeRange) {
		var realRange = document.createRange();

		if (fakeRange.startOffset < 0) {
			var [startContainer, startOffset] = findOffsetElement(fakeRange.startContainer,
				fakeRange.startOffset);
			fakeRange.startContainer = startContainer;
			fakeRange.startOffset = startOffset;
		}

		if (fakeRange.endOffset < 0) {
			var [endContainer, endOffset] = findOffsetElement(fakeRange.endContainer,
				fakeRange.endOffset);
			fakeRange.endContainer = endContainer;
			fakeRange.endOffset = endOffset;
		}

		realRange.setStart(fakeRange.startContainer, fakeRange.startOffset);
		realRange.setEnd(fakeRange.endContainer, fakeRange.endOffset);
		window.getSelection().removeAllRanges();
		window.getSelection().addRange(realRange);
	}

	/**
	 * Recursively navigates an element using path to insert text at an index.
	 * @param {DOMNode} parentElement DOMNode used as root element for path navigation.
	 * @param {DOMPath} path          Path to follow on DOMNode.
	 * @param {int} charIndex         Index in existing string to insert new string at.
	 * @param {string} value          String to be inserted.
	 * @private
	 */
	var insertInText = function(rootElement, path, charIndex, value) {
		var [childElement, childIndex, parentElement, indexType] =
			webstrates.PathTree.elementAtPath(rootElement, path);
		var attributeName = typeof path[path.length-1] === "string" ? path[path.length-1] : undefined;

		switch (indexType) {
			case jsonml.TAG_NAME_INDEX:
				// Diff changes to tag names is not supported.
				throw Error("Unsupported indexType jsonml.TAGNAME_INDEX (0)");
				break;
			case jsonml.ATTRIBUTE_INDEX:
				// This is not necessarily an attribute change, because the attribuet object in JsonML is
				// optional. Therefore, it may just be a change made to a comment or regular text node
				// without an attribute object. We verify by seeing if an attribute name exists.
				if (attributeName) {
					// Attribute value diff.
					attributeName = path.pop();
					// The SVG stuff below is a hack, because Microsoft Edge rounds the d value on SVG paths,
					// which messes up our attribute diffing. We also do this in deleteInText below.
					var isSvgPath = childElement.tagName.toLowerCase() === "path" && attributeName === "d";
					var oldValue = childElement.getAttribute(attributeName);
					if (isSvgPath) oldValue = childElement.__d;
					var newValue = oldValue.substring(0, charIndex)
						+ value + oldValue.substring(charIndex);
					if (isSvgPath) childElement.__d = newValue;
					childElement.setAttribute(attributeName, newValue);
					childElement.webstrate.fireEvent("attributeChanged", attributeName, oldValue, newValue,
						false);
					break;
				}
				// If not an attribute value change: fall-through.
			default:
				// Text node or comment content change.
				var isComment = parentElement.nodeType === document.COMMENT_NODE;
				var parentElement = isComment ? parentElement : childElement;
				var oldValue = parentElement.data;
				var newValue = oldValue.substring(0, charIndex)
					+ value + oldValue.substring(charIndex);
				var fakeRange = getSelectionRange(parentElement);
				parentElement.data = newValue;
				if (!fakeRange) {
					break;
				}
				// Adjust the range to account for the insertion.
				if (fakeRange.endContainer === parentElement && fakeRange.endOffset > charIndex) {
					fakeRange.endOffset += value.length;
					if (fakeRange.startContainer === parentElement && fakeRange.startOffset >= charIndex) {
						fakeRange.startOffset += value.length;
					}

				}
				// Update selection
				setSelectionRange(parentElement, fakeRange);
				break;
		}

		// Create and dispatch deprecated events. This should be removed, eventually.
		var event = new CustomEvent("insertText", {
			detail: { position: charIndex, value: value, attributeName: attributeName }
		});
		parentElement.dispatchEvent(event);

		// Notify insertText listeners.
		parentElement.webstrate.fireEvent("insertText", charIndex, value, attributeName);
	};

	/**
	 * Recursively navigates an element using path to delete text at an index.
	 * @param {DOMNode} parentElement DOMNode used as root element for path navigation.
	 * @param {DOMPath} path          Path to follow on DOMNode.
	 * @param {int} charIndex         Index in existing string to remove string from.
	 * @param {string} value          String to be removed.
	 * @private
	 */
	var deleteInText = function(rootElement, path, charIndex, value) {
		var [childElement, childIndex, parentElement, indexType] =
			webstrates.PathTree.elementAtPath(rootElement, path);
		var attributeName = typeof path[path.length-1] === "string" ? path[path.length-1] : undefined;

		switch (indexType) {
			case jsonml.TAG_NAME_INDEX:
				// Diff changes to tag names is not supported.
				throw Error("Unsupported indexType jsonml.TAGNAME_INDEX (1)");
				break;
			case jsonml.ATTRIBUTE_INDEX:
				if (attributeName) {
					// Attribute value diff.
					attributeName = path.pop();
					// The SVG stuff below is a hack, because Microsoft Edge rounds the d value on SVG paths,
					// which messes up our attribute diffing. We also do this in insertInText above.
					var isSvgPath = childElement.tagName.toLowerCase() === "path" && attributeName === "d";
					var oldValue = childElement.getAttribute(attributeName);
					if (isSvgPath) oldValue = childElement.__d;
					var newValue = oldValue.substring(0, charIndex)
						+ oldValue.substring(charIndex + value.length);
					if (isSvgPath) childElement.__d = newValue;
					childElement.setAttribute(attributeName, newValue);
					childElement.webstrate.fireEvent("attributeChanged", attributeName, oldValue, newValue,
						false);
					break;
				}
				// If not an attribute value change: fall-through.
			default:
				// Text node or comment content change.
				var isComment = parentElement.nodeType === document.COMMENT_NODE;
				var parentElement = isComment ? parentElement : childElement;
				var oldValue = parentElement.data;
				var newValue = oldValue.substring(0, charIndex)
					+ oldValue.substring(charIndex + value.length);
				var fakeRange = getSelectionRange(parentElement);
				parentElement.data = newValue;
				if (!fakeRange) {
					break;
				}

				// Adjust the range to account for the deletion.
				if (fakeRange.endContainer === parentElement && fakeRange.endOffset > charIndex) {
					fakeRange.endOffset -= value.length;
					if (fakeRange.startContainer === parentElement && fakeRange.startOffset >= charIndex) {
						fakeRange.startOffset -= value.length;
					}

				}

				// Update selection
				setSelectionRange(parentElement, fakeRange);
				break;
		}

		// Create and dispatch deprecated events. This should be removed, eventually.
		var event = new CustomEvent("deleteText", {
			detail: { position: charIndex, value: value, attributeName: attributeName }
		});
		parentElement.dispatchEvent(event);

		// Notify deleteText listeners.
		parentElement.webstrate.fireEvent("deleteText", charIndex, value, attributeName);
	};

	/**
	 * Apply an operation to an element.
	 * @param  {Op} op   Operation to be applied. Contains path and op type.
	 * @param  {DOMNode} DOMNode used as root element for path navigation.
	 * @public
	 */
	var applyOp = function(op, rootElement) {
		var path = op.p;
		if (path.length === 0) {
			return;
		}

		// We have to use "prop in obj" syntax, because not all properties have a value, necessarily
		// (i.e. `oi`).
		if ("si" in op || "sd" in op) {
			// For string insertions and string deletions, we extract the character index from the path.
			var charIndex = path.pop();
		}

		if ("oi" in op || "od" in op) {
			// For attribute insertions and attribute deletions, we extract the attribtue name from the
			// path.
			var attributeName = path.pop();

			// The __wid attribute is a unique ID assigned each node and should not be in the DOM.
			if (attributeName.toLowerCase() === "__wid") {
				return;
			}
		}
		// Attribute insertion (object insertion). Also catches replace operations, i.e. operations with
		// both `oi` and `od`.
		if ("oi" in op) {
			return setAttribute(rootElement, path, attributeName, op.oi);
		}

		// Attribute removal (object deletion)
		if ("od" in op) {
			return removeAttribute(rootElement, path, attributeName);
		}

		// String deletion.
		if ("sd" in op) {
			return deleteInText(rootElement, path, charIndex, op.sd);
		}

		// String insertion.
		if ("si" in op) {
			return insertInText(rootElement, path, charIndex, op.si);
		}

		// Node replacement, either a regular node, tag renaming, or a complete replacement of
		// attributes.
		if ("li" in op && "ld" in op) {
			return replaceNode(rootElement, path, op.li);
		}

		// Element deletion operation (list deletion).
		if ("ld" in op) {
			return deleteNode(rootElement, path);
		}

		// Element insertion operation (list insertion).
		if ("li" in op) {
			return insertNode(rootElement, path, op.li);
		}
	};

	webstrates.applyOp = applyOp;

	return webstrates;

})(root.webstrates || {});