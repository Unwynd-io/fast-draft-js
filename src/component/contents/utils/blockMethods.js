
function isElementList (element) {
  return ['OL', 'UL'].includes(element.tagName);
}

function getElementWrapper (element) {
  return element.parentElement.parentElement;
}

function isElementWrapped (element) {
  const wrapper = getElementWrapper(element);
  return wrapper.getAttribute('number-list-element') === 'true' || wrapper.getAttribute('ordered-list-element') === 'true';
}

export function getPreviousSibling (element, count, callback) {

  const newElement = callback ? callback(element) : element;

  if (!newElement) {
    return null;
  }

  if (count === 0) {
    return newElement;
  }

  if (!newElement.previousSibling) {

    const wrapperElement = getElementWrapper(newElement);

    // Case for the list elements
    if (isElementWrapped(newElement)) {
      if (wrapperElement.previousSibling) {
        return getPreviousSibling(wrapperElement.previousSibling, count - 1, callback);
      } else if (isElementList(wrapperElement.parentElement) && wrapperElement.parentElement.previousSibling) {
        return getPreviousSibling(wrapperElement.parentElement.previousSibling, count - 1, callback);
      }
    }

    return newElement;
  }

  return getPreviousSibling(newElement.previousSibling, count - 1, callback);
}

export function getNextSibling (element, count, callback) {

  const newElement = callback ? callback(element) : element;

  if (!newElement) {
    return null;
  }

  if (count === 0) {
    return newElement;
  }
  
  if (!newElement.nextSibling) {
    
    const wrapperElement = getElementWrapper(newElement);

    // Case for the list elements
    if (isElementWrapped(newElement)) {
      if (wrapperElement.nextSibling) {
        return getNextSibling(wrapperElement.nextSibling, count - 1, callback);
      } else if (isElementList(wrapperElement.parentElement) && wrapperElement.parentElement.nextSibling) {
        return getNextSibling(wrapperElement.parentElement.nextSibling, count - 1, callback);
      }
    }


    return newElement;
  }

  return getNextSibling(newElement.nextSibling, count - 1, callback);
}

export function getFirstDraftBlock (element, isFirst = true) {
  if (element?.dataset?.offsetKey && !isElementList(element)) {
    return element;
  }

  const childrenCount = element?.children?.length;
  
  if (childrenCount > 0) {
    // If we are in a list we want to get the first or last element of the list depending on the direction
    const elementToGet = isFirst ? 0 : childrenCount - 1;
    return getFirstDraftBlock(element?.children?.[elementToGet], isFirst);
  }

  return null;
}


export function getBlockByKey (blockKey) {
  return document.querySelector(`[data-offset-key="${blockKey}-0-0"]`);
};


module.exports = {
  // Block navigation
  getPreviousSibling,
  getNextSibling,
  getFirstDraftBlock,

  // Block getters
  getBlockByKey
}