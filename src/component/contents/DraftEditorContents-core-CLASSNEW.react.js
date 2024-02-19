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
import { findDOMNode } from 'react-dom';

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

/*
 * Constants
 */

const DRAFT_BLOCK_HEIGHT = 50; // ~47px
const MAX_BLOCKS_TO_DISPLAY = 50;
const LAZY_LOAD_BLOCK_OFFSET = 4;

/*
 * Utill methods
 */

const getHandleIntersection = (callback) => (entries, observer) => {
  // console.log('[f] props of intersection', {entries, observer})

  entries.forEach(entry => {
    callback(entry, observer);
  });
}

// const compareElementPosition = (elm1, elm2) => {
//   const rootElm = elm1.getBoundingClientRect();
//   const targetElm = elm2.getBoundingClientRect();

//   const topDiff = rootElm.top - targetElm.top;
//   const bottomDiff = rootElm.bottom - targetElm.bottom;

//   console.log('[f] [scroll] %c compareElementPosition', 'color: #123153', {rootElm, targetElm, topDiff, bottomDiff});
// }

// window.__compareElementPosition = compareElementPosition;

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
  // console.log('[f] [draft] CALL getLazyLoadedBlocks - props', {editorState, blocks: _blocks, initialBlockKey});

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
      const isOpen = block.getData().get('isOpen')
      const isSectionOpen = typeof isOpen === 'boolean' ? isOpen : true;
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
    // console.log('[f] [draft] last block is not the same', {lastOriginalBlock, lastFilteredBlock})
    const blockType = lastOriginalBlock.getType();
    const block = mapFilteredBlock(lastOriginalBlock, {index: _blocks.length - 1, isSection: blockType === 'ordered-list-item', hidden: true});
    blocks.push(block)
  }

  // console.log('[f] [draft] filtere blocks: ', {blocks});
  
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

  // console.log('[f] [draft] getLazyLoadedBlocks - props', {
  //   lazyLoadBlockIndex,
  //   _startOffsetBlockIndex,
  //   _endOffsetBlockIndex,
  //   startOffsetBlockIndex,
  //   endOffsetBlockIndex,
  //   blockOnIndex: blocks[lazyLoadBlockIndex],
  //   initialBlockKey,
  //   blocks,
  //  })

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

  // console.log('[f] [draft] %c calc lazy load blocks', 'color: #163432', {start, end, difference, _startOffsetBlockIndex, _endOffsetBlockIndex, startOffsetBlockIndex, endOffsetBlockIndex});

  /*
   * Map the lazy blocks
   */

  const FIRST_BLOCK = 0;
  const LAST_BLOCK = blocks.length - 1;

  if (start > FIRST_BLOCK) {
    // console.log('[f] [draft] start > FIRST_BLOCK, adding first block')
    lazyLoadBlockIndexes.push(FIRST_BLOCK);
  }

  // Start selection off screen (ABOVE)
  if (startSelectionExists && (_startOffsetBlockIndex < start && _startOffsetBlockIndex !== FIRST_BLOCK)) {
    // console.log('[f] [draft] loading START selection off screen ABOVE')
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (ABOVE)
  if (endSelectionExists && ((_endOffsetBlockIndex < start && _endOffsetBlockIndex !== FIRST_BLOCK)
    && _endOffsetBlockIndex !== _startOffsetBlockIndex)) {
    // console.log('[f] [draft] loading END selection off screen ABOVE')
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
    // console.log('[f] [draft] loading START selection off screen BELOW')
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (BELOW)
  if (endSelectionExists &&  ((_endOffsetBlockIndex > end && _endOffsetBlockIndex !== LAST_BLOCK)
    && _endOffsetBlockIndex !== _startOffsetBlockIndex)) {
    // console.log('[f] [draft] loading END selection off screen BELOW')
    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  if (end < LAST_BLOCK + 1) {
    // console.log('[f] [draft] end < LAST_BLOCK, loading last block')
    lazyLoadBlockIndexes.push(_blocks.length - 1);
  }

  // console.log('[f] [draft] GET INDEXES, CALCULTATED: ', {lazyLoadBlockIndexes})

  return lazyLoadBlockIndexes;
}

const getTopObservableBlock = (firstChild) => getNextSibling(firstChild, LAZY_LOAD_BLOCK_OFFSET, (elm) => getFirstDraftBlock(elm, true));
const getBottomObservableBlock = (lastChild) => getPreviousSibling(lastChild, LAZY_LOAD_BLOCK_OFFSET, (elm) => getFirstDraftBlock(elm, false));

/**
 * `DraftEditorContents` is the container component for all block components
 * rendered for a `DraftEditor`. It is optimized to aggressively avoid
 * re-rendering blocks whenever possible.
 *
 * This component is separate from `DraftEditor` because certain props
 * (for instance, ARIA props) must be allowed to update without affecting
 * the contents of the editor.
 */
class DraftEditorContents extends React.Component<Props> {
  constructor(props) {
    super(props);
    this.state = {
      outputBlockIndexes: [],
      currentLazyLoad: {},
      currentFocusBlockKey: null,
      // const [outputBlockIndexes, setOutputBlockIndexes] = React.useState([]);
      // const [currentLazyLoad, setCurrentLazyLoad] = React.useState({});
      // const [currentFocusBlockKey, setCurrentFocusBlockKey] = React.useState(null);
    };
    this.contentsRef = React.createRef();

    // Lazy load observers
    this.observerLazyTop = React.createRef();
    this.observerLazyBottom = React.createRef();
    this.observedElmTop = React.createRef();
    this.observedElmBottom = React.createRef();

    this.observedElmTopParams = React.createRef();
    this.observedElmBottomParams = React.createRef();

    // For top scrolling
    this.isTopOfPage = React.createRef();
    this.topBlocksOffsetHeight = React.createRef();

    this.canObserve = React.createRef();

    // Handlers
    this.getBlockByKey = this.getBlockByKey.bind(this);
    this.handleFocusBlock = this.handleFocusBlock.bind(this);
    this.handleUnobserve = this.handleUnobserve.bind(this);
    this.handleUpdateScrollPosition = this.handleUpdateScrollPosition.bind(
      this,
    );
    this.handleCreateObservers = this.handleCreateObservers.bind(this);
    this.handleEditorScroll = this.handleEditorScroll.bind(this);
  }

  /*
   * Handlers
   */

  getBlockByKey = blockKey => {
    return document.querySelector(`[data-offset-key="${blockKey}-0-0"]`);
  };

  handleFocusBlock = blockKey => {
    // console.log('[f] handleFocusBlock', {blockKey})

    const block = this.getBlockByKey(blockKey);
    // console.log('[f] handleFocusBlock', {block})

    if (block) {
      block.scrollIntoView({behavior: 'instant', block: 'center'});
    }
  };

  handleUnobserve = (observer, element) => {
    // console.log('[f] %c disconnecting obersever handleUnobserve', 'color: #234632', {observer, element})

    if (observer) {
      // console.log('[f] -disconnect')
      observer.unobserve(element);
    }
  };

  // FOR infinite scroll issue:
  // dtk6k - on the 3rd up, or quickly scroll up
  // ?1rl32

  handleUpdateScrollPosition = ({
    currentLazyLoad,
    firstChild,
    lastChild,
    firstChildParamsBefore,
    lastChildParamsBefore,
  }) => {
    // console.log('[f] [scroll] %c UPDATING SCORLL POSTION, ', 'color: #161', {
    //   currentLazyLoad,
    //   outputBlockIndexes: this.state.outputBlockIndexes,
    //   blockKeyToScrollTo: this.props.blockKeyToScrollTo,
    //   currentFocusBlockKey: this.state.currentFocusBlockKey,
    //   props: this.props,
    //   firstChild,
    //   lastChild,
    //   firstChildParamsBefore,
    //   lastChildParamsBefore,
    // });

    let newScrollPosition = null;

    // const lchNode = domNode.querySelector(`[data-offset-key="${lastChild?.dataset?.offsetKey}"]`)

    let oldRects, newRects;

    if (!!firstChild && currentLazyLoad.direction === 'TOP') {
      oldRects = firstChildParamsBefore;
      newRects = firstChild.getBoundingClientRect?.();

      // Backup when DOM is not fully calculated
      if (
        firstChild.getClientRects()
          .length === 0
      ) {
        const domNode = findDOMNode(
          this,
        );
        const fchNode = domNode.querySelector(
          `[data-offset-key="${firstChild.dataset.offsetKey}"]`,
        );

        newRects = fchNode?.getBoundingClientRect?.();
        // console.log(
        //   '[f] [scroll] newRects TOP replacement',
        //   {
        //     newRects,
        //     newRectsTest: fchNode?.getClientRects(),
        //     offsetTop:
        //       fchNode?.offsetTop,
        //   },
        // );
      }
    } else if (currentLazyLoad.direction === 'BOTTOM') {
      oldRects = lastChildParamsBefore;
      newRects = lastChild.getBoundingClientRect();
    }

    if (
      !!newRects &&
      !!oldRects &&
      newRects.top !== 0 &&
      oldRects.top !== newRects.top
    ) {
      const currentScroll = this.contentsRef.current.parentElement.scrollTop;
      newScrollPosition = currentScroll + (newRects.top - oldRects.top);

      // console.log('[f] [scroll] %c scrolling to', 'color: #125122', {
      //   currentScroll,
      //   newScrollPosition,
      //   OBS_EL: this.observedElmTop,
      //   oldRectsTop: oldRects.top,
      //   newRectsTop: newRects.top,
      // });
    }

    // console.log('[f] [scroll] after calculation');

    if (newScrollPosition) {
      // console.log(
      //   '[f] [scroll] %c handleUpdateScrollPosition',
      //   'color: #772237',
      //   {newScrollPosition},
      // );
      const scrollElm = this.contentsRef.current.parentElement;
      scrollElm.scrollTop = newScrollPosition;
    }
  };

  handleCreateObservers = () => {
    // console.log('[f] [draft] handleCreateObservers');
    let firstChild = getTopObservableBlock(
      this.contentsRef?.current?.firstChild,
    ); // getNextSibling(contentsRefthis.?.current?.firstChild, LAZY_LOAD_BLOCK_OFFSET, (elm) => getFirstDraftBlock(elm, true));
    let lastChild = getBottomObservableBlock(
      this.contentsRef?.current?.lastChild,
    ); // getPreviousSibling(contentsRef?.current?.lastChild, LAZY_LOAD_BLOCK_OFFSET, (elm) => getFirstDraftBlock(elm, false));

    window.__devTopElement = firstChild;
    window.__devBottomElement = lastChild;

    // console.log('[f] [draft] %c OBSERVING NEW', 'color: #532523', {
    //   nowKey: this.state.currentLazyLoad.key,
    //   observerTop: this.observerLazyTop.current,
    //   observerBottom: this.observerLazyBottom.current,
    //   firstChild,
    //   lastChild,
    // });

    if (!firstChild || !lastChild) {
      // console.log('[f] %c NO FIRST OR LAST CHILD', 'color: red', {firstChild, lastChild})
      return;
    }

    let oldRectsParamsTop = this.observedElmTopParams.current;
    let oldRectsParamsBottom = this.observedElmBottomParams.current;

    // The initial load - no previous values
    if (!oldRectsParamsTop) {
      // console.log('[f] [draft] NO PREVIOUS VALUE TOP');
      oldRectsParamsTop = this.observedElmTop.current?.getBoundingClientRect();
    }

    if (!oldRectsParamsBottom) {
      // console.log('[f] [draft] NO PREVIOUS VALUE BOTTOM');
      oldRectsParamsBottom = this.observedElmBottom.current?.getBoundingClientRect();
    }

    this.handleUpdateScrollPosition({
      currentLazyLoad: this.state.currentLazyLoad,
      firstChild: this.observedElmTop.current,
      lastChild: this.observedElmBottom.current,
      firstChildParamsBefore: oldRectsParamsTop,
      lastChildParamsBefore: oldRectsParamsBottom,
    });

    this.handleUnobserve(
      this.observerLazyTop.current,
      this.observedElmTop.current,
    );
    this.handleUnobserve(
      this.observerLazyBottom.current,
      this.observedElmBottom.current,
    );

    const observerCallback = direction =>
      getHandleIntersection((entry, observer) => {

        if (entry.isIntersecting) {
          observer.disconnect();
          const blockKey = entry?.target?.dataset?.offsetKey?.split('-')?.[0];
          // console.log(
          //   `[f] [draft] %c SETTING NEW BLOCK ${direction} Target div is now in the viewport!`,
          //   'color: #565432',
          //   {entry, observer, blockKey, firstChild, lastChild},
          // );

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

          // if (direction === 'TOP') {
          //   const elmTopParams = {
          //     rects: firstChild.getBoundingClientRect(),
          //   };
          //   this.observedElmTopParams.current = elmTopParams;
          //   console.log('[f] [scroll] STORING OLD VALUES: ', {elmTopParams});
          // }

          // if (direction === 'BOTTOM') {
          //   const elmBottomParams = {
          //     rects: lastChild.getBoundingClientRect(),
          //   };
          //   this.observedElmBottomParams.current = elmBottomParams;
          //   console.log('[f] [scroll] STORING OLD VALUES: ', {elmBottomParams});
          // }

          this.setState({
            ...this.state,
            currentLazyLoad: {
              key: blockKey,
              direction,
            },
          });
          // setCurrentLazyLoad({
          //   key: blockKey,
          //   direction,
          // });
        }
      });

    const observerSettings = {
      root: this.contentsRef.current.parentElement,
      rootMargin: '100px 0px 0px 0px',
    };

    this.observerLazyTop.current = new IntersectionObserver(
      observerCallback('TOP'),
      observerSettings,
    );
    this.observerLazyBottom.current = new IntersectionObserver(
      observerCallback('BOTTOM'),
      observerSettings,
    );

    this.observedElmTop.current = firstChild;
    this.observedElmBottom.current = lastChild;

    this.observerLazyTop.current.observe(this.observedElmTop.current);
    this.observerLazyBottom.current.observe(this.observedElmBottom.current);

    // console.log('[f] [draft] AFTER OBSERVER INIT', {
    //   observerBottom: this.observerLazyBottom.current,
    //   obsererTop: this.observerLazyTop.current,
    //   topElm: this.observedElmTop.current,
    //   bottomElm: this.observedElmBottom.current,
    // });
  };

  handleEditorScroll = e => {
    // console.log('[f] [scroll] %c SCROLL EVENT', 'color: #849', {e, scrollTop: scrollElm.scrollTop, isTopOfPage, topElm: observedElmTop.current, bottomElm: observedElmBottom.current, observerTop: observerLazyTop.current, observerBottom: observerLazyBottom.current})

    const scrollElm = this.contentsRef.current.parentElement;
    const currentScroll = scrollElm.scrollTop;

    if (!this.isTopOfPage.current) {
      if (currentScroll < this.topBlocksOffsetHeight.current) {
        // console.log(`[f] [scroll] %c RESETTING SCROLL TO ${this.topBlocksOffsetHeight.current}px`, 'color: #123153', {e, scrollTop: scrollElm.scrollTop, isTopOfPage, topElm: observedElmTop.current, bottomElm: observedElmBottom.current, observerTop: observerLazyTop.current, observerBottom: observerLazyBottom.current})
        scrollElm.scrollTop = this.topBlocksOffsetHeight.current;
      }
    }
  };

  shouldComponentUpdate(nextProps: Props, nextState): boolean {
    // console.log(
    //   '[f] shouldComponentUpdate IN DraftEditorContents-core.react.js',
    //   {
    //     nextState,
    //     currentState: this.state,
    //     shouldUpdateObserver:
    //       this.state.currentLazyLoad.key !== nextState.currentLazyLoad.key,
    //     nextBlockMapArr: nextProps?.editorState
    //       ?.getCurrentContent()
    //       ?.getBlockMap()
    //       ?.toArray(),
    //   },
    // );

    const prevEditorState = this.props.editorState;
    const nextEditorState = nextProps.editorState;

    const prevDirectionMap = prevEditorState.getDirectionMap();
    const nextDirectionMap = nextEditorState.getDirectionMap();

    // Text direction has changed for one or more blocks. We must re-render.
    if (prevDirectionMap !== nextDirectionMap) {
      return true;
    }

    const didHaveFocus = prevEditorState.getSelection().getHasFocus();
    const nowHasFocus = nextEditorState.getSelection().getHasFocus();

    if (didHaveFocus !== nowHasFocus) {
      return true;
    }

    const nextNativeContent = nextEditorState.getNativelyRenderedContent();

    const wasComposing = prevEditorState.isInCompositionMode();
    const nowComposing = nextEditorState.isInCompositionMode();

    const prevState = this.state;
    const stateChanged = prevState !== nextState;

    // If the state is unchanged or we're currently rendering a natively
    // rendered state, there's nothing new to be done.
    if (
      !stateChanged &&
      (prevEditorState === nextEditorState ||
        (nextNativeContent !== null &&
          nextEditorState.getCurrentContent() === nextNativeContent) ||
        (wasComposing && nowComposing))
    ) {
      // console.log('[f] RETURNING FALSE 1', {wasComposing, nowComposing});
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
    //   result:
    //     wasComposing !== nowComposing ||
    //     prevContent !== nextContent ||
    //     prevDecorator !== nextDecorator ||
    //     nextEditorState.mustForceSelection() ||
    //     stateChanged ||
    //     prevSelection !== nextSelection ||
    //     prevFocusKey !== nextFocusKey,

    //   currentState: this.state,
    //   nextState,
    // });

    return (
      wasComposing !== nowComposing ||
      prevContent !== nextContent ||
      prevDecorator !== nextDecorator ||
      nextEditorState.mustForceSelection() ||
      stateChanged ||
      prevSelection !== nextSelection ||
      prevFocusKey !== nextFocusKey
    );
  }

  componentDidMount() {
    const blocksAsArray = this.props.editorState
      .getCurrentContent()
      .getBlocksAsArray();
    let lazyLoadBlocks = blocksAsArray.slice(
      0,
      MAX_BLOCKS_TO_DISPLAY + LAZY_LOAD_BLOCK_OFFSET * 2,
    );
    let outputBlockIndexes = Array.from(
      {length: lazyLoadBlocks.length},
      (v, k) => k,
    );
    // setOutputBlockIndexes(outputBlockIndexes);
    this.setState({
      ...this.state,
      outputBlockIndexes,
    });

    this.canObserve.current = true;
    this.isTopOfPage.current = true;

    const scrollElm = this.contentsRef.current.parentElement;

    scrollElm.addEventListener('scroll', this.handleEditorScroll);
  }

  getSnapshotBeforeUpdate(prevProps, prevState) {
    if (
      this.contentsRef?.current &&
      this.state.outputBlockIndexes !== prevState.outputBlockIndexes
    ) {
      const firstChild = getTopObservableBlock(
        this.contentsRef?.current?.firstChild,
      );
      const lastChild = getBottomObservableBlock(
        this.contentsRef?.current?.lastChild,
      );

      if (!firstChild || !lastChild) {
        return null;
      }

      const topElm = this.observedElmTop.current;
      const bottomElm = this.observedElmBottom.current;

      const observerElmTopRects = topElm?.getBoundingClientRect();
      const observerElmBottomRects = bottomElm?.getBoundingClientRect();

      this.observedElmTopParams.current = observerElmTopRects;
      this.observedElmBottomParams.current = observerElmBottomRects;
    }

    return null;
  }

  // Before render 1 - Update currentLazyLoad - currentLazyLoad is updated
  // componentDidUpdate 1 - Update outputBlockIndexes

  // Before render 2 - outputBlockIndexes are updated, currentLazyLoad is the same (new)
  // componentDidUpdate 2 - currently and scroll position - does not work properly (DOM NOT YET UPDATED)

  // Before render 3 - DOM should be updated here, so we should update the scrolling here
  // componentDidUpdate 3 - Updating the observers here after DOM is updated

  componentDidUpdate(prevProps, prevState, snapshot) {
    // console.log('[f] [draft] %c CLASS COMPONENT DID UPDATE', 'color: #562162', {
    //   snapshot,
    //   prevProps,
    //   prevState,
    //   props: this.props,
    //   state: this.state,
    //   CURRENT_LAZY_LOAD: this.state.currentLazyLoad,
    //   PREV_LAZY_LOAD: prevState.currentLazyLoad,
    //   CURRENT_LAZY_LOAD_DIFFERENT:
    //     this.state.currentLazyLoad !== prevState.currentLazyLoad,

    //   CURRENT_EDITOR_STATE: this.props.editorState,
    //   PREV_EDITOR_STATE: prevProps.editorState,
    //   CURRENT_EDITOR_STATE_DIFFERENT:
    //     this.props.editorState !== prevProps.editorState,
    // });

    /*
     * Calculate indexes to render
     */

    let outputBlockIndexes = this.state.outputBlockIndexes;

    if (
      prevProps.editorState !== this.props.editorState ||
      prevState.currentLazyLoad !== this.state.currentLazyLoad
    ) {
      const blocksAsArray = this.props.editorState
        .getCurrentContent()
        .getBlocksAsArray();

      // console.log(
      //   '[f] [draft] [scroll] %c componentDidUpdate 1 - CALC INDEXES',
      //   'color: #888854',
      //   {
      //     currentLazyLoad: this.state.currentLazyLoad,
      //     blockKeyToScrollTo: this.props.blockKeyToScrollTo,
      //     blocksAsArray,
      //     props: this.props,
      //   },
      // );

      let areIndexesSorted = false;

      if (this.state.currentLazyLoad.key > '') {
        // console.log('[f]  [draft] LAZY LOAD KEY EXISTS, CALCULATING INDEXES', {
        //   currentLazyLoad: this.state.currentLazyLoad,
        //   blockKeyToScrollTo: this.props.blockKeyToScrollTo,
        //   blocksAsArray,
        //   props: this.props,
        // });

        outputBlockIndexes = getLazyLoadedBlockIndexes({
          editorState: this.props.editorState,
          blocks: blocksAsArray,
          initialBlockKey: this.state.currentLazyLoad.key,
        });
        // setOutputBlockIndexes(outputBlockIndexes);
        this.setState({
          ...this.state,
          outputBlockIndexes,
        });

        // The first value is always loaded and index equals to 0 -> every value after should be only 1 more than the previous
        // MAX_SLICE_TO_CHECK -> Any number over 3 should be okay, since we need to account only for 0 index, and selection.start and selection.end, and the rest won't be "sorted" unless we are at the top of the page
        const MAX_SLICE_TO_CHECK = 6;
        areIndexesSorted = outputBlockIndexes
          .slice(0, MAX_SLICE_TO_CHECK)
          .every((val, i, arr) => !i || arr[i - 1] === arr[i] - 1);

        // console.log('[f] [scroll] %c USE LAYOUT EFFECT - CALC INDEXES - AFTER', 'color: #888854', {areIndexesSorted})

      } else if (!this.state.currentLazyLoad.key) {
        // console.log('[f] [draft] no lazy load key, only first blocks');
        let lazyLoadBlocks = blocksAsArray.slice(
          0,
          MAX_BLOCKS_TO_DISPLAY + LAZY_LOAD_BLOCK_OFFSET * 2,
        );
        outputBlockIndexes = Array.from(
          {length: lazyLoadBlocks.length},
          (v, k) => k,
        );
        // setOutputBlockIndexes(outputBlockIndexes);
        this.setState({
          ...this.state,
          outputBlockIndexes,
        });
        areIndexesSorted = true;
      }

      // setTopOfPage(areIndexesSorted);
      this.isTopOfPage.current = areIndexesSorted;

    }

    /*
     * Events on indexes change
     */

    // prevState.outputBlockIndexes !== outputBlockIndexes || prevState.currentLazyLoad !== this.state.currentLazyLoad

    if (prevState.outputBlockIndexes !== outputBlockIndexes) {
      // console.log('[f] [draft] IN OBSERVERS');

      const oldRefTop = this.observedElmTop.current;
      const oldRefBottom = this.observedElmBottom.current;

      let firstChild = getTopObservableBlock(
        this.contentsRef?.current?.firstChild,
      );
      let lastChild = getBottomObservableBlock(
        this.contentsRef?.current?.lastChild,
      );
      const isDOMUpdated =
        oldRefTop !== firstChild || oldRefBottom !== lastChild;
      const shouldLazyLoad = outputBlockIndexes.length > MAX_BLOCKS_TO_DISPLAY;

      // console.log(
      //   '[f] [scroll] %c componentDidUpdate 2 RECREATE OBSERVERS ON SCROLL, ',
      //   'color: #123153',
      //   {
      //     canObserve: this.canObserve.current,
      //     isDOMUpdated,
      //     firstChild,
      //     lastChild,
      //     contentsRef: this.contentsRef.current,
      //     OBSTOP: this.observedElmTop.current,
      //     OBSBOTTOM: this.observedElmBottom.current,
      //     outputBlockIndexes: outputBlockIndexes,
      //   },
      // );

      // TODO: improve performance on state change when we don't need to recalculate lazyBlocks
      // if (this.state.shouldRecalculateLazyLoad) {
      //   this.setState({...this.state, shouldRecalculateLazyLoad: false});
      // } else {
      // }

      /*
       * Calculate blocks offset
       */

      if (isDOMUpdated) {
        let topBlocksOffsetHeight = DRAFT_BLOCK_HEIGHT; // Fallback value

        if (!!this.contentsRef?.current?.firstChild) {
          // getNextSibling(this.contentsRef?.current?.firstChild, 2, elm => {
            const draftElm = getFirstDraftBlock(this.contentsRef?.current?.firstChild, true);

            if (draftElm) {
              topBlocksOffsetHeight = draftElm.offsetHeight;
            }

            // return draftElm;
          // });

          // console.log('[f] topBlocksOffsetHeight', {topBlocksOffsetHeight})

          this.topBlocksOffsetHeight.current = topBlocksOffsetHeight;
        }
      }

      /*
       * Refresh the observers on scroll
       */

      // Setting the observers
      if (
        this.canObserve.current &&
        shouldLazyLoad &&
        !!this.contentsRef?.current?.lastChild &&
        isDOMUpdated
      ) {
        // console.log('[f] [scroll] CALLING CREATE OBSERVERS');
        this.handleCreateObservers();
      }
    }

    /*
     * Focus on the block
     */

    const blockKeyToScrollTo = this.props.editorState.getBlockKeyToScrollTo();
    let currentFocusBlockKey = this.state.currentFocusBlockKey;

    if (blockKeyToScrollTo !== prevProps.editorState.getBlockKeyToScrollTo()) {
      // console.log(
      //   '[f] [draft] %c componentDidUpdate 3 - FOCUS ON BLOCK',
      //   'color: #643171',
      //   {currentLazyLoad: this.state.currentLazyLoad, blockKeyToScrollTo},
      // );
      if (blockKeyToScrollTo > '') {
        if (blockKeyToScrollTo !== this.state.currentLazyLoad.key) {
          this.handleUnobserve(
            this.observerLazyTop.current,
            this.observedElmTop.current,
          );
          this.handleUnobserve(
            this.observerLazyBottom.current,
            this.observedElmBottom.current,
          );
          // setCanObserve(false);
          // setCurrentFocusBlockKey(blockKeyToScrollTo);
          // setCurrentLazyLoad({key: blockKeyToScrollTo, direction: 'FOCUS'});
          this.canObserve.current = false;

          currentFocusBlockKey = blockKeyToScrollTo;
          this.setState({
            ...this.state,
            currentFocusBlockKey,
            currentLazyLoad: {key: currentFocusBlockKey, direction: 'FOCUS'},
          });

          // console.log('[f] SETTING THE KEY AND FOCUSING ON BLOCK', {currentLazyLoad, props})
        } else {
          // console.log('[f] SHOULD FOCUS ON BLOCK', {currentLazyLoad, props})
          this.handleFocusBlock(blockKeyToScrollTo);
        }
      }
    }

    /*
     * Focus on the block after loading the DOM
     */

    if (
      outputBlockIndexes !== prevState.outputBlockIndexes ||
      this.state.currentFocusBlockKey !== prevState.currentFocusBlockKey
    ) {
      // console.log(
      //   '[f] [draft] %c componentDidUpdate 4 - FOCUS ON BLOCK AFTER LOADING THE DOM',
      //   'color: #123171',
      //   {
      //     currentLazyLoad: this.state.currentLazyLoad,
      //     blockKeyToScrollTo,
      //     currentFocusBlockKey,
      //     outputBlockIndexes,
      //     prevOutputBlockIndexes: prevState.outputBlockIndexes,
      //   },
      // );

      if (
        this.state.currentFocusBlockKey > '' &&
        !!this.getBlockByKey(this.state.currentFocusBlockKey)
      ) {
        // console.log('[f] [draft] ACTUALLY FOCUSING ON BLOCK');

        this.handleFocusBlock(this.state.currentFocusBlockKey);
        this.canObserve.current = true;
        this.handleCreateObservers();
        this.setState({
          ...this.state,
          currentFocusBlockKey: null,
        });
      }
    }
  }

  componentWillUnmount() {
    // console.log('[f] [draft] CLASS componentWillUnmount', {
    //   props: this.props,
    //   state: this.state,
    // });

    const scrollElm = this.contentsRef.current.parentElement;
    scrollElm.removeEventListener('scroll', this.handleEditorScroll);
  }

  render(): React.Node {
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
    } = this.props;

    const {outputBlockIndexes} = this.state;

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
      const block = blocksAsArray[outputBlockIndexes[i]];
      if (block) {
        lazyLoadBlocks.push(block);
      }
    }

    // console.log('[f] [draft] %c [render] ', 'color: #9999', {
    //   lazyLoadBlocks,
    //   blocksAsArray,
    //   outputBlockIndexes,
    //   topBlocksOffsetHeight: this.topBlocksOffsetHeight.current,
    // });

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

      const configForType =
        blockRenderMap.get(blockType) || blockRenderMap.get('unstyled');
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

    // Group contiguous runs of blocks that have the same wrapperTemplate
    const outputBlocks = [];
    for (let ii = 0; ii < processedBlocks.length; ) {
      const info: any = processedBlocks[ii];

      // console.log('[f] render inside checkubg - info', {info, ii});

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
          // console.log('[f] RENDER - LAST BLOCK - add event listenr to block', {
          //   block,
          // });
        }
      }
    }

    // console.log('[f] render inside - props', {outputBlocks});

    return (
      <div data-contents="true" ref={this.contentsRef}>
        {outputBlocks}
      </div>
    );
  }
}


// TODO: test scrollToRef and other use-cases
// TODO: test this: only set the currentLazyLoad to the block that's inside the lazy loaded blocks (no selection or first/last blocks) - what happens if selection is on currentLazyLoad.key block
// TODO: improve performance on backspace (see why it happens and do not recalulate the indexes unless blockMap changes)
// TODO: refactor code in this component: move out util methods and constants, remove comments, improve code
// TODO: try to fix blockKeyToScrollTo (reset in the editor) or add timestamp tracking
// TODO: style the clauses
// TODO: move the package to a private repositry
// TODO: publish private (or public) package
// TODO: look into tooltips and editor preview
// TODO: (optional) try to implement our own scrollbar

module.exports = DraftEditorContents;