/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @oncall draft_js
 */

'use strict';

import type {BlockNodeRecord} from 'BlockNodeRecord';
import type {DraftBlockRenderMap} from 'DraftBlockRenderMap';
import type {DraftInlineStyle} from 'DraftInlineStyle';
import type EditorState from 'EditorState';
import type {BidiDirection} from 'UnicodeBidiDirection';

const DraftEditorBlock = require('DraftEditorBlock.react');
const DraftOffsetKey = require('DraftOffsetKey');

const cx = require('cx');
const joinClasses: (
  className?: ?string,
  ...classes: Array<?string>
) => string = require('joinClasses');
const nullthrows = require('nullthrows');
const React = require('react');

type Props = {
  blockRenderMap: DraftBlockRenderMap,
  blockRendererFn: (block: BlockNodeRecord) => ?Object,
  blockStyleFn: (block: BlockNodeRecord) => string,
  customStyleFn?: (style: DraftInlineStyle, block: BlockNodeRecord) => ?Object,
  customStyleMap?: Object,
  editorKey?: string,
  editorState: EditorState,
  preventScroll?: boolean,
  textDirectionality?: BidiDirection,
  ...
};


/**
 * Provide default styling for list items. This way, lists will be styled with
 * proper counters and indentation even if the caller does not specify
 * their own styling at all. If more than five levels of nesting are needed,
 * the necessary CSS classes can be provided via `blockStyleFn` configuration.
 */
const getListItemClasses = (
  type: string,
  depth: number,
  shouldResetCount: boolean,
  direction: BidiDirection,
): string => {
  return cx({
    'public/DraftStyleDefault/unorderedListItem':
      type === 'unordered-list-item',
    'public/DraftStyleDefault/orderedListItem': type === 'ordered-list-item',
    'public/DraftStyleDefault/reset': shouldResetCount,
    'public/DraftStyleDefault/depth0': depth === 0,
    'public/DraftStyleDefault/depth1': depth === 1,
    'public/DraftStyleDefault/depth2': depth === 2,
    'public/DraftStyleDefault/depth3': depth === 3,
    'public/DraftStyleDefault/depth4': depth >= 4,
    'public/DraftStyleDefault/listLTR': direction === 'LTR',
    'public/DraftStyleDefault/listRTL': direction === 'RTL',
  });
};


// TODO: move constants and utils to separate folders

/*
 * Constants
 */

const DRAFT_BLOCK_HEIGHT = 50; // ~47px
const MAX_BLOCKS_TO_DISPLAY = 50;
const LAZY_LOAD_BLOCK_OFFSET = 4;

const MAX_SCROLL_OFFSET = LAZY_LOAD_BLOCK_OFFSET * DRAFT_BLOCK_HEIGHT;

/*
 * Utill methods
 */

const getHandleIntersection = (callback) => (entries, observer) => {
  // console.log('[f] props of intersection', {entries, observer})

  entries.forEach(entry => {
    callback(entry, observer);
  });
}

const isElementList = (element) => {
  return ['OL', 'UL'].includes(element.tagName);
}

const getElementWrapper = (element) => {
  return element.parentElement.parentElement;
}

const isElementWrapped = (element) => {
  const wrapper = getElementWrapper(element);
  return wrapper.getAttribute('number-list-element') === 'true' || wrapper.getAttribute('ordered-list-element') === 'true';
}

const getPreviousSibling = (element, count, callback) => {
  // console.log('[getPreviousSibling]', {element, elPreviousSibling: element.previousSibling, count})

  const newElement = callback ? callback(element) : element;

  if (count === 0) {
    return newElement;
  }

  if (!newElement.previousSibling) {

    const wrapperElement = getElementWrapper(newElement);

    // Case for the list elements
    if (isElementWrapped(newElement)) {
      if (wrapperElement.previousSibling) {
        // console.log('[f] getting previous of wrapper element', {wrapperElement, wrapperPrev: wrapperElement.previousSibling, count})
        return getPreviousSibling(wrapperElement.previousSibling, count - 1, callback);
      } else if (isElementList(wrapperElement.parentElement) && wrapperElement.parentElement.previousSibling) {
        // console.log('[f] getting previous of wrapper element parent', {wrapperElementParent: wrapperElement.parentElement, wrapperPrev: wrapperElement.parentElement.previousSibling, count})
        return getPreviousSibling(wrapperElement.parentElement.previousSibling, count - 1, callback);
      }
    }

    return newElement;
  }

  return getPreviousSibling(newElement.previousSibling, count - 1, callback);
}

const getNextSibling = (element, count, callback) => {
  // console.log('[f] getnextSibling', {element, elNextSibling: element.nextSibling, count})

  const newElement = callback ? callback(element) : element;
  // console.log('[f] getnextSibling after callback', {newElement, elNextSibling: element.nextSibling, count})

  if (count === 0) {
    return newElement;
  }
  
  if (!newElement.nextSibling) {
    
    const wrapperElement = getElementWrapper(newElement);

    // Case for the list elements
    if (isElementWrapped(newElement)) {
      if (wrapperElement.nextSibling) {
        // console.log('[f] getting next of wrapper element', {wrapperElement, wrapperNext: wrapperElement.nextSibling, count})
        return getNextSibling(wrapperElement.nextSibling, count - 1, callback);
      } else if (isElementList(wrapperElement.parentElement) && wrapperElement.parentElement.nextSibling) {
        // console.log('[f] getting next of wrapper element parent', {wrapperElementParent: wrapperElement.parentElement, wrapperNext: wrapperElement.parentElement.nextSibling, count})
        return getNextSibling(wrapperElement.parentElement.nextSibling, count - 1, callback);
      }
    }


    return newElement;
  }

  return getNextSibling(newElement.nextSibling, count - 1, callback);
}

const getFirstDraftBlock = (element, isFirst = true) => {
  // console.log('[f] getFirstDraftBlock', {element, isFirst})
  if (element?.dataset?.offsetKey && !isElementList(element)) {
    return element;
  }

  const childrenCount = element?.children?.length;
  
  if (childrenCount > 0) {
    const elementToGet = isFirst ? 0 : childrenCount - 1;
    return getFirstDraftBlock(element?.children?.[elementToGet], isFirst);
  }

  return null;
}


const mapFilteredBlock = (block, {index, isSection, hidden}) => {
  block.originalIndex = index;
  block.isSection = isSection;
  block.hidden = typeof hidden === 'boolean' ? hidden : false;
  return block;
}

const getLazyLoadedBlockIndexes = ({editorState, blocks: _blocks, initialBlockKey}): number[] => {
  console.log('[f] [draft] CALL getLazyLoadedBlocks - props', {editorState, blocks: _blocks, initialBlockKey});

  /*
   * Remove blocks that are inside hidden sections
   */


  // [0 (always), 1, 2, 3, 4, 5, 6, ...n(always)]

  // 0 always
  // 1 - section hidden
  // 2 - no render
  // 3 - no render 
  // 4 - no render 
  // 5 - no render 
  // 6 - no render 
  // 7 - no render 
  // 8 - no render 
  // 9 - no render 
  // 10 - section open
  // 11 - render
  // 12 - render
  // 13 - render
  // 14 - render
  // 15 - render
  // 16 last - always

  // output - 0, 1, 10, 11, 12, 13, 14, 15, 16


  // TODO: check what happens if last block is in hidden section but on the screen  
  
  let shouldSkipBlocks = false;

  let blocks = [];

  for (let i = 0; i < _blocks.length; i++) {
    
    const block = _blocks[i];
    const blockType = block.getType();
    const blockDepth = block.getDepth();

    // block.originalIndex = i;
    // block.isSection = blockType === 'ordered-list-item';

    block = mapFilteredBlock(block, {index: i, isSection: blockType === 'ordered-list-item'});

    // console.log('[f] [draft] checking block: ', {block, blockType, blockDepth, blockData: block.getData().toObject()})

    if (blockType === 'ordered-list-item' && blockDepth === 0) {
      const isSectionOpen = block.getData().get('isOpen');
      shouldSkipBlocks = !isSectionOpen;
      blocks.push(block);
      continue;
    }

    if (shouldSkipBlocks) {
      continue;
    }

    blocks.push(block);
  }


  const lastOriginalBlock = _blocks[_blocks.length - 1];
  const lastFilteredBlock = blocks[blocks.length - 1];

  if (lastOriginalBlock.getKey() !== lastFilteredBlock.getKey()) {
    console.log('[f] [draft] last block is not the same', {lastOriginalBlock, lastFilteredBlock})
    const blockType = lastOriginalBlock.getType();
    const block = mapFilteredBlock(lastOriginalBlock, {index: _blocks.length - 1, isSection: blockType === 'ordered-list-item', hidden: true});
    blocks.push(block)
  }


  console.log('[f] [draft] filtere blocks: ', {blocks});
  
  let lazyLoadBlockIndexes = [];

  const editorSelection = editorState.getSelection();
  const _startOffsetBlockIndex = blocks.findIndex(block => block.key === editorSelection.getStartKey()); // Indexes of blocks in filtered array
  const _endOffsetBlockIndex = blocks.findIndex(block => block.key === editorSelection.getEndKey()); // Indexes of blocks in filtered array
  const startSelectionExists = _startOffsetBlockIndex !== -1;
  const endSelectionExists = _endOffsetBlockIndex !== -1;

  let startOffsetBlockIndex = 0; // Actual indexes of blocks in blockMap
  let endOffsetBlockIndex = 0; // Actual indexes of blocks in blockMap

  if (startSelectionExists) {
    startOffsetBlockIndex = blocks[_startOffsetBlockIndex].originalIndex;
  }

  if (endSelectionExists) {
    startOffsetBlockIndex = blocks[_endOffsetBlockIndex].originalIndex;
  }

  const lazyLoadBlockIndex = blocks.findIndex(block => block.key === initialBlockKey);

  console.log('[f] [draft] getLazyLoadedBlocks - props', {
    lazyLoadBlockIndex,
    _startOffsetBlockIndex,
    _endOffsetBlockIndex,
    startOffsetBlockIndex,
    endOffsetBlockIndex,
    blockOnIndex: blocks[lazyLoadBlockIndex],
    initialBlockKey,
    blocks,
   })

  const BLOCK_RANGE = Math.floor(MAX_BLOCKS_TO_DISPLAY / 2);

  /*
   * Calculate lazy blocks
   */ 

  let start = lazyLoadBlockIndex - BLOCK_RANGE - LAZY_LOAD_BLOCK_OFFSET;
  let end = lazyLoadBlockIndex + BLOCK_RANGE + LAZY_LOAD_BLOCK_OFFSET;

  let difference = 0;

  if (start < 0) {
    difference = Math.abs(start);
    start = 0;
    end += difference;
  }

  if (end > blocks.length) {
    end = blocks.length;
    start = end - MAX_BLOCKS_TO_DISPLAY;

    if (start < 0) {
      start = 0;
    }
  }

  console.log('[f] [draft] %c calc lazy load blocks', 'color: #163432', {start, end, difference, _startOffsetBlockIndex, _endOffsetBlockIndex, startOffsetBlockIndex, endOffsetBlockIndex});

  /*
   * Map the lazy blocks
   */

  const FIRST_BLOCK = 0;
  const LAST_BLOCK = blocks.length - 1;
  // TODO: check what should be last block

  if (start > FIRST_BLOCK) {
    console.log('[f] [draft] start > FIRST_BLOCK, adding first block')
    lazyLoadBlockIndexes.push(FIRST_BLOCK);
  }

  // Start selection off screen (ABOVE)
  if (startSelectionExists && (_startOffsetBlockIndex < start && _startOffsetBlockIndex !== FIRST_BLOCK)) {
    console.log('[f] [draft] loading START selection off screen ABOVE')
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (ABOVE)
  if (endSelectionExists && ((_endOffsetBlockIndex < start && _endOffsetBlockIndex !== FIRST_BLOCK)
    && _endOffsetBlockIndex !== _startOffsetBlockIndex)) {
    console.log('[f] [draft] loading END selection off screen ABOVE')
    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  // Loading the slice
  // lazyLoadBlockIndexes = lazyLoadBlockIndexes.concat(lazySlice);
  for (let i = start; i < end; i++) {
    const block = blocks[i];
    lazyLoadBlockIndexes.push(block.originalIndex);
  }

  // Start selection off screen (BELOW)
  if (startSelectionExists && (_startOffsetBlockIndex > end && _startOffsetBlockIndex !== LAST_BLOCK)) {
    console.log('[f] [draft] loading START selection off screen BELOW')
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (BELOW)
  if (endSelectionExists &&  ((_endOffsetBlockIndex > end && _endOffsetBlockIndex !== LAST_BLOCK)
    && _endOffsetBlockIndex !== _startOffsetBlockIndex)) {
    console.log('[f] [draft] loading END selection off screen BELOW')
    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  if (end < LAST_BLOCK + 1) {
    console.log('[f] [draft] end < LAST_BLOCK, loading last block')
    lazyLoadBlockIndexes.push(LAST_BLOCK);
  }

  console.log('[f] [draft] GET INDEXES, CALCULTATED: ', {lazyLoadBlockIndexes})

  return lazyLoadBlockIndexes;
}

const getShouldComponentUpdate = (prevProps, nextProps) => {

  console.log('[f] %c NEW getShouldComponentUpdate IN DraftEditorContents-core.react.js', 'color: #123125', {prevBlockMap:  prevProps?.editorState?.getCurrentContent()?.getBlockMap()?.toArray(), nextBlockMapArr: nextProps?.editorState?.getCurrentContent()?.getBlockMap()?.toArray()});

  const prevEditorState = prevProps.editorState;
  const nextEditorState = nextProps.editorState;

  const prevDirectionMap = prevEditorState.getDirectionMap();
  const nextDirectionMap = nextEditorState.getDirectionMap();

  // Text direction has changed for one or more blocks. We must re-render.
  if (prevDirectionMap !== nextDirectionMap) {
    // console.log('[f] REUTRN EARLY - SHOULD UPDATE 1')
    return true;
  }

  const didHaveFocus = prevEditorState.getSelection().getHasFocus();
  const nowHasFocus = nextEditorState.getSelection().getHasFocus();

  if (didHaveFocus !== nowHasFocus) {
    // console.log('[f] REUTRN EARLY - SHOULD UPDATE 2')
    return true;
  }

  const nextNativeContent = nextEditorState.getNativelyRenderedContent();

  const wasComposing = prevEditorState.isInCompositionMode();
  const nowComposing = nextEditorState.isInCompositionMode();

  // If the state is unchanged or we're currently rendering a natively
  // rendered state, there's nothing new to be done.
  if (
    prevEditorState === nextEditorState ||
      (nextNativeContent !== null &&
        nextEditorState.getCurrentContent() === nextNativeContent) ||
      (wasComposing && nowComposing)
  ) {
    // console.log('[f] RETURNING FALSE 1 - NO UPDATE', {wasComposing, nowComposing});
    return false;
  }

  const prevContent = prevEditorState.getCurrentContent();
  const nextContent = nextEditorState.getCurrentContent();
  const prevDecorator = prevEditorState.getDecorator();
  const nextDecorator = nextEditorState.getDecorator();
  const prevSelection = prevEditorState.getSelection();
  const nextSelection = nextEditorState.getSelection();
  const prevFocusKey = prevEditorState.getBlockKeyToScrollTo();
  const nextFocusKey = nextEditorState.getBlockKeyToScrollTo();

  // console.log('[f] SHOULD UPDATE? FINAL STEP', {
  //   result: wasComposing !== nowComposing ||
  //   prevContent !== nextContent ||
  //   prevDecorator !== nextDecorator ||
  //   nextEditorState.mustForceSelection() ||
  //   prevSelection !== nextSelection ||
  //   prevFocusKey !== nextFocusKey
  // })

  return (
    wasComposing !== nowComposing ||
    prevContent !== nextContent ||
    prevDecorator !== nextDecorator ||
    nextEditorState.mustForceSelection() ||
    prevSelection !== nextSelection ||
    prevFocusKey !== nextFocusKey
  );
}

const DraftEditorContents = React.memo((props) => {

  const contentsRef = React.useRef(null);
  const disableScrollEventsRef = React.useRef(false);
  const disableScrollEvents = disableScrollEventsRef.current;

  const observerLazyTop = React.useRef(null);
  const observerLazyBottom = React.useRef(null);
  const observedElmTop = React.useRef(null);
  const observedElmBottom = React.useRef(null);

  // const [outputBlocks, setOutputBlocks] = React.useState([]);
  const [outputBlockIndexes, setOutputBlockIndexes] = React.useState([]);
  const [currentLazyLoadKey, setCurrentLazyLoadKey] = React.useState(null);
  const [currentFocusBlockKey, setCurrentFocusBlockKey] = React.useState(null);

  // Only first "batch" is loaded
  const isTopOfPageRef = React.useRef(true);
  const isTopOfPage = isTopOfPageRef.current;
  const setTopOfPage = (value) => {
    isTopOfPageRef.current = value;
  }

  const canObserve = React.useRef(true);
  const setCanObserve = (value) => {
    canObserve.current = value;
  }

  const blockKeyToScrollTo = props.editorState.getBlockKeyToScrollTo();

  /*
   * Handlers
   */

  const getBlockByKey = (blockKey) => {
    return document.querySelector(`[data-offset-key="${blockKey}-0-0"]`);
  }

  const handleFocusBlock = (blockKey) => {
    // console.log('[f] handleFocusBlock', {blockKey})

    const block = getBlockByKey(blockKey);
    // console.log('[f] handleFocusBlock', {block})

    if (block) {
      block.scrollIntoView({behavior: 'instant', block: 'center'});
    }
  }

  const handleUnobserve = (observer, element) => {
    // console.log('[f] %c disconnecting obersever handleUnobserve', 'color: #234632', {observer, element})

    if (observer) {
      // console.log('[f] -disconnect')
      observer.unobserve(element);
    }
  }

  // FOR infinite scroll issue: 
  // dtk6k - on the 3rd up, or quickly scroll up
  // ?1rl32


  const handleCreateObservers = () => {
    console.log('[f] [draft] handleCreateObservers')
    let firstChild = getNextSibling(contentsRef?.current?.firstChild, LAZY_LOAD_BLOCK_OFFSET, (elm) => getFirstDraftBlock(elm, true));
    let lastChild = getPreviousSibling(contentsRef?.current?.lastChild, LAZY_LOAD_BLOCK_OFFSET, (elm) => getFirstDraftBlock(elm, false));

    window.__devTopElement = firstChild;
    window.__devBottomElement = lastChild;

    console.log('[f] [draft] %c OBSERVING NEW', 'color: #532523', {
      nowKey: currentLazyLoadKey,
      observerTop: observerLazyTop.current,
      observerBottom: observerLazyBottom.current,
      firstChild,
      lastChild
    })

    if(!firstChild || !lastChild) {
      // console.log('[f] %c NO FIRST OR LAST CHILD', 'color: red', {firstChild, lastChild})
      return;
    }

    handleUnobserve(observerLazyTop.current, observedElmTop.current);
    handleUnobserve(observerLazyBottom.current, observedElmBottom.current);

    const observerCallback = (name) => getHandleIntersection((entry, observer) => {
      console.log(`[f] [draft] %c OBSERVER ${name} INTERSECTED CALLBACK`, 'color: #772323', {
        entry, 
        observer,
        lastChild,
        entryTarget: entry?.target,
        entryTargetDataset: entry?.target?.dataset,
      });

      if (entry.isIntersecting) {
        observer.disconnect();
        const blockKey = entry?.target?.dataset?.offsetKey?.split('-')?.[0];
        console.log(`[f] [draft] %c SETTING NEW BLOCK ${name} Target div is now in the viewport!`, 'color: #565432', {entry, observer, blockKey, firstChild, lastChild});

        // TODO: only set the currentLazyLoadKey to the block that's inside the lazy loaded blocks (no selection or first/last blocks)
        /* ^ not sure if this code is the right idea for above.
          const indexOfLazyBlock = lazyLoadBlocks.findIndex(block => block.key === blockKey);
          if(indexOfLazyBlock == -1 || indexOfLazyBlock === 1 || indexOfLazyBlock === lazyLoadBlocks.length - 1) {
            return;
          }
          const { anchorKey, focusKey } = selection;
          const lazyBlock = lazyLoadBlocks[indexOfLazyBlock];
          if(lazyBlock.key === anchorKey || lazyBlock.key === focusKey) {
            return;
          }
        */
        
        setCurrentLazyLoadKey(blockKey);
      }
    })

    const observerSettings = {
      root: contentsRef.current.parentElement,
      rootMargin: "0px 0px 0px 0px",
    }

    // console.log('[f] observerSettings', {observerSettings})

    observerLazyTop.current = new IntersectionObserver(observerCallback('TOP'), observerSettings);
    observerLazyBottom.current = new IntersectionObserver(observerCallback('BOTTOM'), observerSettings);

    observedElmTop.current = firstChild;
    observedElmBottom.current = lastChild;

    observerLazyTop.current.observe(observedElmTop.current);
    observerLazyBottom.current.observe(observedElmBottom.current);

    console.log('[f] [draft] AFTER OBSERVER INIT', {observerBottom: observerLazyBottom.current, obsererTop: observerLazyTop.current, topElm: observedElmTop.current, bottomElm: observedElmBottom.current})
  }

  /*
   * Refresh the observers on scroll
   */

  React.useEffect(() => {
    const currentBlockMap = props?.editorState?.getCurrentContent()?.getBlockMap();
    const shouldLazyLoad = outputBlockIndexes.length > MAX_BLOCKS_TO_DISPLAY && currentBlockMap.size > MAX_BLOCKS_TO_DISPLAY;

    console.log('[f] [scroll] %c useEffect RECREATE OBSERVERS ON SCROLL, ', 'color: #123153', { outputBlockIndexes, blockMapSize: currentBlockMap.size, shouldLazyLoad});

    // console.log('[f] [scroll] %c useEffect, ', 'color: #123153', {
    //   shouldLazyLoad,
    //   currentLazyLoadKey,
    //   currentBlockMapArr: currentBlockMap.toArray(),
    //   currentProps: props,
    //   blockKeyToScrollTo,
    //   currentFocusBlockKey,
    //   topElm: observedElmTop.current,
    //   bottomElm: observedElmBottom.current,
    //   observerTop: observerLazyTop.current,
    //   observerBottom: observerLazyBottom.current,
    //   contents: contentsRef?.current?.children,
    //   firstChild: contentsRef?.current?.firstChild,
    //   lastChild: contentsRef?.current?.lastChild,
    //   outputBlockIndexes,
    // })

    // TODO: improve performance on state change when we don't need to recalculate lazyBlocks
    // if (this.state.shouldRecalculateLazyLoad) {
    //   this.setState({...this.state, shouldRecalculateLazyLoad: false});
    // } else {
    // }

    /*
     * Setting the observers
    */
    
    if (canObserve.current && shouldLazyLoad && !!contentsRef?.current?.lastChild ) {
      handleCreateObservers();
    }

  }, [outputBlockIndexes, props?.editorState?.getCurrentContent()?.getBlockMap()]);

  /*
   * Focus on the block after loading the DOM
   */

  React.useEffect(() => {
    if (currentFocusBlockKey > '' && !!getBlockByKey(currentFocusBlockKey)) {
      handleFocusBlock(currentFocusBlockKey);
      setCanObserve(true);
      handleCreateObservers();
      setCurrentFocusBlockKey(null);
    }

  }, [outputBlockIndexes, currentFocusBlockKey])


  /*
   * Calculate indexes to render
   */

  React.useEffect(() => {
    const blocksAsArray = props.editorState.getCurrentContent().getBlocksAsArray();

    console.log('[f] [draft] [scroll] %c USE EFFECT - CALC INDEXES', 'color: #888854', {currentLazyLoadKey, blockKeyToScrollTo, blocksAsArray, props})

    let outputBlockIndexes = [];
    let areIndexesSorted = false;

    if(currentLazyLoadKey > '') {
      outputBlockIndexes = getLazyLoadedBlockIndexes({editorState: props.editorState, blocks: blocksAsArray, initialBlockKey: currentLazyLoadKey})
      setOutputBlockIndexes(outputBlockIndexes);

      // The first value is always loaded and index equals to 0 -> every value after should be only 1 more than the previous
      // MAX_SLICE_TO_CHECK -> Any number over 3 should be okay, since we need to account only for 0 index, and selection.start and selection.end, and the rest won't be "sorted" unless we are at the top of the page
      const MAX_SLICE_TO_CHECK = 6;
      areIndexesSorted = outputBlockIndexes.slice(0, MAX_SLICE_TO_CHECK).every((val, i, arr) => !i || (arr[i - 1] === arr[i] - 1));

      // console.log('[f] [scroll] %c USE LAYOUT EFFECT - CALC INDEXES - AFTER', 'color: #888854', {areIndexesSorted})

      // // TODO: try and leave first and last block in the array
      // // TODO: earlier lazy loading
      // // TODO: for selection that is manual start and end => show them in the dom anyway even if they are "unloaded"
      // // TODO: for scroll to ref - add an initial lazy block key as prop 

      // // TODO: fix infinite scrolling (happens only if the observed element is a list element)
      // TODO: fix issue when deleting a block that is currentLazyLoadKey? test
      // TODO: for hidden clauses - refactor clauses
      // TODO: improve performance on backspace (see why it happens and do not recalulate the indexes unless blockMap changes)
    } else if (currentLazyLoadKey === null) {
      let lazyLoadBlocks = blocksAsArray.slice(0, MAX_BLOCKS_TO_DISPLAY + (LAZY_LOAD_BLOCK_OFFSET * 2));
      outputBlockIndexes = Array.from({length: lazyLoadBlocks.length}, (v, k) => k);
      setOutputBlockIndexes(outputBlockIndexes);
      areIndexesSorted = true;
    }

    setTopOfPage(areIndexesSorted);

    console.log('[f] [draft] [scroll] LAYOUT FINISHED ', {outputBlockIndexes, areIndexesSorted})
  }, [currentLazyLoadKey, props.editorState])

  /*
   * Focus on the block
   */

  // TODO: try to tweak so that there is no need to reset blockKeyToScrollTo from the parent component manually
  React.useEffect(() => {
    console.log('[f] [draft] %c USE EFFECT - FOCUS ON BLOCK', 'color: #643171', {currentLazyLoadKey, blockKeyToScrollTo})
    if (blockKeyToScrollTo > '') {
      if (blockKeyToScrollTo !== currentLazyLoadKey) {
        handleUnobserve(observerLazyTop.current, observedElmTop.current);
        handleUnobserve(observerLazyBottom.current, observedElmBottom.current);
        setCanObserve(false);
        setCurrentFocusBlockKey(blockKeyToScrollTo);
        setCurrentLazyLoadKey(blockKeyToScrollTo);
        // console.log('[f] SETTING THE KEY AND FOCUSING ON BLOCK', {currentLazyLoadKey, props})
      } else {
        // console.log('[f] SHOULD FOCUS ON BLOCK', {currentLazyLoadKey, props})
        handleFocusBlock(blockKeyToScrollTo);
        // TODO: check collapsed clauses
      }
    }
  }, [blockKeyToScrollTo])

  /*
   * Custom scrolling
   */

  const handleEnabelMouseWheel = () => {
    disableScrollEventsRef.current = false;
  }
  
  const handleScroll = (scrollTop, scrollLeft) => {
    console.log('[f] [scroll] %c handleScroll', 'color: #363474', {e, currentLazyLoadKey, outputBlockIndexes});

    // scrollElement.scrollTop = scrollTop;
    // scrollElement.scrollLeft = scrollLeft;

    disableScrollEventsRef.current = true;
    requestAnimationFrame(handleEnabelMouseWheel); 
  }

  const handleMouseWheel = (e) => {
    // will prevent the creation of scroll event
    e.preventDefault();
    // will stop propagation to other wheel event listeners
    e.stopPropagation();

    // limit the browser to 1 manual scroll event per frame
    if (disableScrollEvents) {
      console.log('[f] [scroll] %c handleMouseWheel PREVENTED', 'color: red',  {e, delta: {
        x: e.deltaX,
        y: e.deltaY,
        mode: e.deltaMode,
      }, currentLazyLoadKey, outputBlockIndexes});

      return false;
    }
    const scrollElement = contentsRef.current.parentElement;

    let deltaY = e.deltaY
    let deltaX = e.deltaX
     
    // check e.deltaMode, 0 for pixels (default), 1 for lines, 2 for pages
    const isLinesScroll = e.deltaMode === 1;
    const isPagesScroll = e.deltaMode === 2;
     
     
    if (isLinesScroll) {
      deltaY = deltaY * 10;
      deltaX = deltaX * 10;
    }
     
     
    if (isPagesScroll) {
      deltaY = deltaY * 25;
      deltaX = deltaX * 25;
    }
    

    const newScrollTop = scrollElement.scrollTop + deltaY;
    const newScrollLeft = scrollElement.scrollLeft + deltaX;

    console.log('[f] [scroll] %c handleMouseWheel', 'color: #532611', {deltaY: e.deltaY, newY: newScrollTop, mode: e.deltaMode, currentLazyLoadKey, outputBlockIndexes, e});

    scrollElement.scroll(newScrollLeft, newScrollTop);
    
    // get scrollTop and scrollLeft values from the element
    // values can't be lower than 0
    const scrollTop = scrollElement.scrollTop;
    const scrollLeft = scrollElement.scrollLeft;

    handleScroll(scrollTop, scrollLeft);
  }


  React.useEffect(() => {
    const scrollElement = contentsRef.current.parentElement;

    console.log('[f] [scroll] INIT SCROLL EVENT LISTENER', {scrollElement});

    if (scrollElement) {

      scrollElement.addEventListener('wheel', handleMouseWheel, {passive: false});

      return () => {
        scrollElement.removeEventListener('wheel', handleMouseWheel);
      }
    }
  }, [outputBlockIndexes])

  /*
   * Workaround for the scrollTop === 0 position, we should not allow the user to be at the top unless we are at the top of the page 
   */

  // React.useEffect(() => {

  //   const scrollElm = contentsRef.current.parentElement;

  //   const handleScroll = (e) => {
  //     // console.log('[f] [scroll] %c SCROLL EVENT', 'color: #849', {e, scrollTop: scrollElm.scrollTop, isTopOfPage, topElm: observedElmTop.current, bottomElm: observedElmBottom.current, observerTop: observerLazyTop.current, observerBottom: observerLazyBottom.current})

  //     const currentScroll = scrollElm.scrollTop;

  //     if (!isTopOfPage) {
  //       if (currentScroll < MAX_SCROLL_OFFSET) {
  //         // console.log(`[f] [scroll] %c RESETTING SCROLL TO ${MAX_SCROLL_OFFSET}px`, 'color: #123153', {e, scrollTop: scrollElm.scrollTop, isTopOfPage, topElm: observedElmTop.current, bottomElm: observedElmBottom.current, observerTop: observerLazyTop.current, observerBottom: observerLazyBottom.current})
  //         scrollElm.scrollTop = MAX_SCROLL_OFFSET;
  //       }
  //     }
  //   }

  //   scrollElm.addEventListener('scroll', handleScroll);

  //   return () => {
  //     scrollElm.removeEventListener('scroll', handleScroll);
  //   }
  // }, [isTopOfPage])

  /*
   * Render
   */ 

  // console.log('[f] [scroll] %c render - props', 'color: #777', {currentLazyLoadKey, props, outputBlockIndexes})
    
  const {
    blockRenderMap,
    blockRendererFn,
    blockStyleFn,
    customStyleMap,
    customStyleFn,
    editorState,
    editorKey,
    preventScroll,
    textDirectionality,
  } = props;

  const content = editorState.getCurrentContent();
  const selection = editorState.getSelection();
  const forceSelection = editorState.mustForceSelection();
  const decorator = editorState.getDecorator();
  const directionMap = nullthrows(editorState.getDirectionMap());

  const blocksAsArray = content.getBlocksAsArray();
  const processedBlocks = [];
  const alreadyEncounteredDepth = new Set<number>();
  let currentDepth = null;
  let lastWrapperTemplate = null;

  let lazyLoadBlocks = [];

  for (let i = 0; i < outputBlockIndexes.length; i++) {
    if (i % 10 === 0) {
      // console.log('[f] inserting lazy block (every 10th log)', {i, index: outputBlockIndexes[i], block: blocksAsArray[outputBlockIndexes[i]]})
    }
    const block = blocksAsArray[outputBlockIndexes[i]];
    if (block) {
      lazyLoadBlocks.push(block);
    }
  }

  for (let ii = 0; ii < lazyLoadBlocks.length; ii++) {
    const block = lazyLoadBlocks[ii];
    const key = block.getKey();
    const blockType = block.getType();

    const customRenderer = blockRendererFn(block);
    let CustomComponent, customProps, customEditable;
    if (customRenderer) {
      CustomComponent = customRenderer.component;
      customProps = customRenderer.props;
      customEditable = customRenderer.editable;
    }

    const direction = textDirectionality
      ? textDirectionality
      : directionMap.get(key);
    const offsetKey = DraftOffsetKey.encode(key, 0, 0);
    const componentProps = {
      contentState: content,
      block,
      blockProps: customProps,
      blockStyleFn,
      customStyleMap,
      customStyleFn,
      decorator,
      direction,
      forceSelection,
      offsetKey,
      preventScroll,
      selection,
      tree: editorState.getBlockTree(key),
    };

    const configForType = blockRenderMap.get(blockType) || blockRenderMap.get('unstyled');
    const wrapperTemplate = configForType.wrapper;

    const Element =
      configForType.element || blockRenderMap.get('unstyled').element;

    const depth = block.getDepth();
    let className = '';
    if (blockStyleFn) {
      className = blockStyleFn(block);
    }

    // List items are special snowflakes, since we handle nesting and
    // counters manually.
    if (Element === 'li') {
      const shouldResetCount =
        lastWrapperTemplate !== wrapperTemplate ||
        currentDepth === null ||
        depth > currentDepth ||
        (depth < currentDepth && !alreadyEncounteredDepth.has(depth));
      className = joinClasses(
        className,
        getListItemClasses(blockType, depth, shouldResetCount, direction),
      );
    }

    if (block.hidden) {
      className = joinClasses(className, 'public-DraftEditor-block--hidden');
    }

    alreadyEncounteredDepth.add(depth);

    const Component = CustomComponent || DraftEditorBlock;
    let childProps = {
      className,
      'data-block': true,
      'data-editor': editorKey,
      'data-offset-key': offsetKey,
      key,
    };
    if (customEditable !== undefined) {
      childProps = {
        ...childProps,
        contentEditable: customEditable,
        suppressContentEditableWarning: true,
      };
    }

    const child = React.createElement(
      Element,
      childProps,
      <Component {...componentProps} key={key} />,
    );

    processedBlocks.push({
      block: child,
      wrapperTemplate,
      key,
      offsetKey,
    });

    if (wrapperTemplate) {
      currentDepth = block.getDepth();
    } else {
      currentDepth = null;
    }
    lastWrapperTemplate = wrapperTemplate;
  }

  // console.log('[f] render after processing:', {
  //   currentLazyLoadKey, 
  //   contextText: content.getBlockForKey(currentLazyLoadKey)?.text, 
  //   processedBlocks, 
  //   outputBlockIndexes,
  //   lazyLoadBlocks, blocksAsArray 
  // })

  // Group contiguous runs of blocks that have the same wrapperTemplate
  const outputBlocks = [];
  for (let ii = 0; ii < processedBlocks.length;) {
    const info: any = processedBlocks[ii];

    // console.log('[f] render inside checking - info', {info, ii});

    let block = null;

    if (info.wrapperTemplate) {
      const blocks = [];
      do {
        blocks.push(processedBlocks[ii].block);
        ii++;
      } while (
        ii < processedBlocks.length &&
        processedBlocks[ii].wrapperTemplate === info.wrapperTemplate
      );
      const wrapperElement = React.cloneElement(
        info.wrapperTemplate,
        {
          key: info.key + '-wrap',
          'data-offset-key': info.offsetKey,
        },
        blocks,
      );
      // outputBlocks.push(wrapperElement);
      block = wrapperElement;
    } else {
      // outputBlocks.push(info.block);
      block = info.block;
      ii++;
    }

    if (block) {
      outputBlocks.push(block);
      if (ii === processedBlocks.length) {
        console.log('[f] LAST BLOCK - add event listenr to block', {block});
      }
    }
  }

  // console.log('[f] final outputBlocks', {outputBlocks})

  return (
    <div data-contents="true" ref={contentsRef}>
      {outputBlocks}
    </div>
  );
}

// !the component will not recieve new selection from props if ONLY the selection changes (even with re-render), so copy-paste off-screen won't work because the blocks will not be lazily-loaded properly 

/*
 *
 *
 * If you provide a custom arePropsEqual implementation, you must compare every prop, including functions. Functions often close over the props and state of parent components. If you return true when oldProps.onClick !== newProps.onClick, your component will keep “seeing” the props and state from a previous render inside its onClick handler, leading to very confusing bugs.
 * Avoid doing deep equality checks inside arePropsEqual unless you are 100% sure that the data structure you’re working with has a known limited depth. Deep equality checks can become incredibly slow and can freeze your app for many seconds if someone changes the data structure later.
 *
 * 
 */


  // TODO: fix dragging selection issue when the initial selection is on another block and user starts dragging from another block

, (prevProps, nextProps) => {
  return !getShouldComponentUpdate(prevProps, nextProps);
});

// ! export default causes issue
module.exports = DraftEditorContents;