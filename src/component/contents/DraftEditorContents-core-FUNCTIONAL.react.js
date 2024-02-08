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

const MAX_BLOCKS_TO_DISPLAY = 50;
const LAZY_LOAD_OFFSET = 5;


const getHandleIntersection = (callback) => (entries, observer) => {
  console.log('[f] props of intersection', {entries, observer})

  entries.forEach(entry => {
    callback(entry, observer);
  });
}


const getPreviousSibling = (element, count, callback) => {
  console.log('[getPreviousSibling]', {element, elPreviousSibling: element.previousSibling, count})

  const newElement = callback ? callback(element) : element;

  if (count === 0) {
    return newElement;
  }

  if (!newElement.previousSibling) {
    return newElement;
  }

  return getPreviousSibling(newElement.previousSibling, count - 1, callback);
}

const getNextSibling = (element, count, callback) => {

  const newElement = callback ? callback(element) : element;

  if (count === 0) {
    return newElement;
  }
  
  if (!newElement.nextSibling) {
    return newElement;
  }

  return getNextSibling(newElement.nextSibling, count - 1, callback);
}

const getFirstDraftBlock = (element, isFirst = true) => {
  if (element?.dataset?.offsetKey && !['OL', 'UL'].includes(element.tagName)) {
    return element;
  }

  const childrenCount = element?.children?.length;
  
  if (childrenCount > 0) {
    const elementToGet = isFirst ? 0 : childrenCount - 1;
    return getFirstDraftBlock(element?.children?.[elementToGet]);
  }

  return null;
}


const getLazyLoadedBlockIndexes = ({editorState, blocks, initialBlockKey  }) => {
  
  let lazyLoadBlockIndexes = [];

  const editorSelection = editorState.getSelection();
  const startOffsetBlockIndex = blocks.findIndex(block => block.key === editorSelection.getStartKey());
  const endOffsetBlockIndex = blocks.findIndex(block => block.key === editorSelection.getEndKey());
  const startSelectionExists = startOffsetBlockIndex !== -1;
  const endSelectionExists = endOffsetBlockIndex !== -1;

  const lazyLoadBlockIndex = blocks.findIndex(block => block.key === initialBlockKey);

  console.log('[f] getLazyLoadedBlocks - props', {
    lazyLoadBlockIndex,
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

  let start = lazyLoadBlockIndex - BLOCK_RANGE - LAZY_LOAD_OFFSET;
  let end = lazyLoadBlockIndex + BLOCK_RANGE + LAZY_LOAD_OFFSET;

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

  console.log('[f] %c calc lazy load blocks', 'color: #163432', {start, end, difference, startOffsetBlockIndex, endOffsetBlockIndex});

  /*
   * Map the lazy blocks
   */

  // const lazySlice = blocks.slice(start, end);
  const FIRST_BLOCK = 0;
  const LAST_BLOCK = blocks.length - 1;

  if (start > FIRST_BLOCK) {
    console.log('[f] start > FIRST_BLOCK, adding first block')
    lazyLoadBlockIndexes.push(FIRST_BLOCK);
  }

  // Start selection off screen (ABOVE)
  if (startSelectionExists && (startOffsetBlockIndex < start && startOffsetBlockIndex !== FIRST_BLOCK)) {
    console.log('[f] loading START selection off screen ABOVE')
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (ABOVE)
  if (endSelectionExists && ((endOffsetBlockIndex < start && endOffsetBlockIndex !== FIRST_BLOCK)
  && endOffsetBlockIndex !== startOffsetBlockIndex)) {
    console.log('[f] loading END selection off screen ABOVE')
    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  // Loading the slice
  // lazyLoadBlockIndexes = lazyLoadBlockIndexes.concat(lazySlice);
  for (let i = start; i < end; i++) {
    lazyLoadBlockIndexes.push(i);
  }


  // Start selection off screen (BELOW)
  if (startSelectionExists && (startOffsetBlockIndex > end && startOffsetBlockIndex !== LAST_BLOCK)) {
    console.log('[f] loading START selection off screen BELOW')
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (BELOW)
  if (endSelectionExists &&  ((endOffsetBlockIndex > end && endOffsetBlockIndex !== LAST_BLOCK)
    && endOffsetBlockIndex !== startOffsetBlockIndex)) {
    console.log('[f] loading END selection off screen BELOW')
    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  if (end < LAST_BLOCK + 1) {
    console.log('[f] end < LAST_BLOCK, loading last block')
    lazyLoadBlockIndexes.push(LAST_BLOCK);
  }

  console.log('[f] GET INDEXES, CALCULTATED: ', {lazyLoadBlockIndexes})


  return lazyLoadBlockIndexes;

}


// const getLazyLoadedBlocks = ({editorState, blocks, initialBlockKey  }) => {
  
//   let lazyLoadBlocks = [];

//   const editorSelection = editorState.getSelection();
//   const startOffsetBlockIndex = blocks.findIndex(block => block.key === editorSelection.getStartKey());
//   const endOffsetBlockIndex = blocks.findIndex(block => block.key === editorSelection.getEndKey());
//   const startSelectionExists = startOffsetBlockIndex !== -1;
//   const endSelectionExists = endOffsetBlockIndex !== -1;

//   const lazyLoadBlockIndex = blocks.findIndex(block => block.key === initialBlockKey);

//   console.log('[f] getLazyLoadedBlocks - props', {
//     lazyLoadBlockIndex,
//     startOffsetBlockIndex,
//     endOffsetBlockIndex,
//     blockOnIndex: blocks[lazyLoadBlockIndex],
//     initialBlockKey,
//     blocks,
//    })

//   const BLOCK_RANGE = Math.floor(MAX_BLOCKS_TO_DISPLAY / 2);

//   /*
//    * Calculate lazy blocks
//    */ 

//   let start = lazyLoadBlockIndex - BLOCK_RANGE - LAZY_LOAD_OFFSET;
//   let end = lazyLoadBlockIndex + BLOCK_RANGE + LAZY_LOAD_OFFSET;

//   let difference = 0;

//   if (start < 0) {
//     difference = Math.abs(start);
//     start = 0;
//     end += difference;
//   }

//   if (end > blocks.length) {
//     end = blocks.length;
//     start = end - MAX_BLOCKS_TO_DISPLAY;

//     if (start < 0) {
//       start = 0;
//     }
//   }

//   console.log('[f] %c calc lazy load blocks', 'color: #163432', {start, end, difference, startOffsetBlockIndex, endOffsetBlockIndex});

//   /*
//    * Map the lazy blocks
//    */

//   const lazySlice = blocks.slice(start, end);
//   const FIRST_BLOCK = 0;
//   const LAST_BLOCK = blocks.length - 1;

//   if (start > FIRST_BLOCK) {
//     console.log('[f] start > FIRST_BLOCK, adding first block')
//     lazyLoadBlocks.push(blocks[FIRST_BLOCK]);
//   }

//   // Start selection off screen (ABOVE)
//   if (startSelectionExists && (startOffsetBlockIndex < start && startOffsetBlockIndex !== FIRST_BLOCK)) {
//     console.log('[f] loading START selection off screen ABOVE')
//     lazyLoadBlocks.push(blocks[startOffsetBlockIndex]);
//   }

//   // End selection off screen (ABOVE)
//   if (endSelectionExists && ((endOffsetBlockIndex < start && endOffsetBlockIndex !== FIRST_BLOCK)
//   && endOffsetBlockIndex !== startOffsetBlockIndex)) {
//     console.log('[f] loading END selection off screen ABOVE')
//     lazyLoadBlocks.push(blocks[endOffsetBlockIndex]);
//   }

//   // Loading the slice
//   lazyLoadBlocks = lazyLoadBlocks.concat(lazySlice);

//   // Start selection off screen (BELOW)
//   if (startSelectionExists && (startOffsetBlockIndex > end && startOffsetBlockIndex !== LAST_BLOCK)) {
//     console.log('[f] loading START selection off screen BELOW')
//     lazyLoadBlocks.push(blocks[startOffsetBlockIndex]);
//   }

//   // End selection off screen (BELOW)
//   if (endSelectionExists &&  ((endOffsetBlockIndex > end && endOffsetBlockIndex !== LAST_BLOCK)
//     && endOffsetBlockIndex !== startOffsetBlockIndex)) {
//     console.log('[f] loading END selection off screen BELOW')
//     lazyLoadBlocks.push(blocks[endOffsetBlockIndex]);
//   }

//   if (end < LAST_BLOCK + 1) {
//     console.log('[f] end < LAST_BLOCK, loading last block')
//     lazyLoadBlocks.push(blocks[LAST_BLOCK]);
//   }


//   return lazyLoadBlocks;

// }


/**
 * `DraftEditorContents` is the container component for all block components
 * rendered for a `DraftEditor`. It is optimized to aggressively avoid
 * re-rendering blocks whenever possible.
 *
 * This component is separate from `DraftEditor` because certain props
 * (for instance, ARIA props) must be allowed to update without affecting
 * the contents of the editor.
 */
// class DraftEditorContents extends React.Component<Props> {
//   constructor(props) {
//     super(props);
//     this.state = {
//       currentLazyLoadKey: null,
//       // shouldRecalculateLazyLoad: false,
//     }
//     this.contentsRef = React.createRef(null);

//     // Lazy load observers
//     this.observerLazyTop = React.createRef(null);
//     this.observerLazyBottom = React.createRef(null);
//     this.observedElmTop = React.createRef(null);
//     this.observedElmBottom = React.createRef(null);
//  }

const getShouldComponentUpdate = (prevProps, nextProps) => {

  console.log('[f] NEW getShouldComponentUpdate IN DraftEditorContents-core.react.js', {prevBlockMap:  prevProps?.editorState?.getCurrentContent()?.getBlockMap()?.toArray(), nextBlockMapArr: nextProps?.editorState?.getCurrentContent()?.getBlockMap()?.toArray()});

  const prevEditorState = prevProps.editorState;
  const nextEditorState = nextProps.editorState;

  const prevDirectionMap = prevEditorState.getDirectionMap();
  const nextDirectionMap = nextEditorState.getDirectionMap();

  // Text direction has changed for one or more blocks. We must re-render.
  if (prevDirectionMap !== nextDirectionMap) {
    console.log('[f] REUTRN EARLY - SHOULD UPDATE 1')
    return true;
  }

  const didHaveFocus = prevEditorState.getSelection().getHasFocus();
  const nowHasFocus = nextEditorState.getSelection().getHasFocus();

  if (didHaveFocus !== nowHasFocus) {
    console.log('[f] REUTRN EARLY - SHOULD UPDATE 2')
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
    console.log('[f] RETURNING FALSE 1 - NO UPDATE', {wasComposing, nowComposing});
    return false;
  }

  const prevContent = prevEditorState.getCurrentContent();
  const nextContent = nextEditorState.getCurrentContent();
  const prevDecorator = prevEditorState.getDecorator();
  const nextDecorator = nextEditorState.getDecorator();
  const prevSelection = prevEditorState.getSelection();
  const nextSelection = nextEditorState.getSelection();

  console.log('[f] SHOULD UPDATE? FINAL STEP', {
    result: wasComposing !== nowComposing ||
    prevContent !== nextContent ||
    prevDecorator !== nextDecorator ||
    nextEditorState.mustForceSelection() ||
    prevSelection !== nextSelection
  })

  return (
    wasComposing !== nowComposing ||
    prevContent !== nextContent ||
    prevDecorator !== nextDecorator ||
    nextEditorState.mustForceSelection() ||
    prevSelection !== nextSelection
  );
}

const DraftEditorContents = React.memo((props) => {

  const contentsRef = React.useRef(null);
  const observerLazyTop = React.useRef(null);
  const observerLazyBottom = React.useRef(null);
  const observedElmTop = React.useRef(null);
  const observedElmBottom = React.useRef(null);

  // const [outputBlocks, setOutputBlocks] = React.useState([]);
  const initialCurrentLazyLoadKey = 'RANDOM_STUFF_INITIAL'
  const [currentLazyLoadKey, setCurrentLazyLoadKey] = React.useState(initialCurrentLazyLoadKey);

  const [outputBlockIndexes, setOutputBlockIndexes] = React.useState([]);


  /*
   * Refresh the observers on scroll
   */

  React.useEffect(() => {
    const currentBlockMap = props?.editorState?.getCurrentContent()?.getBlockMap();
    const shouldLazyLoad = currentBlockMap.size > MAX_BLOCKS_TO_DISPLAY;

    console.log('[f] %c useEffect, ', 'color: #123153', {
      shouldLazyLoad,
      currentLazyLoadKey,
      currentBlockMapArr: currentBlockMap.toArray(),
      currentProps: props,
      topElm: observedElmTop.current,
      bottomElm: observedElmBottom.current,
      observerTop: observerLazyTop.current,
      observerBottom: observerLazyBottom.current,
      contents: contentsRef?.current?.children,
      firstChild: contentsRef?.current?.firstChild,
      lastChild: contentsRef?.current?.lastChild,
      outputBlockIndexes,
    })

    // TODO: improve performance on state change when we don't need to recalculate lazyBlocks
    // if (this.state.shouldRecalculateLazyLoad) {
    //   this.setState({...this.state, shouldRecalculateLazyLoad: false});
    // } else 
    
    if (shouldLazyLoad && !!contentsRef?.current?.lastChild) {
      // let firstChild = getNextSibling(getFirstDraftBlock(this.contentsRef?.current?.firstChild, true), LAZY_LOAD_OFFSET);
      
      let firstChild = getNextSibling(contentsRef?.current?.firstChild, LAZY_LOAD_OFFSET, (elm) => getFirstDraftBlock(elm, true));
      let lastChild = getPreviousSibling(contentsRef?.current?.lastChild, LAZY_LOAD_OFFSET, (elm) => getFirstDraftBlock(elm, false));

      console.log('[f] %c OBSERVING NEW', 'color: #532523', {
        // wasKey: prevState.currentLazyLoadKey,
        nowKey: currentLazyLoadKey,
        observerTop: observerLazyTop.current,
        observerBottom: observerLazyBottom.current,
        firstChild,
        lastChild
      })
      // startObserver(false);

      if(!firstChild || !lastChild) {
        console.log('[f] %c NO FIRST OR LAST CHILD', 'color: red', {firstChild, lastChild})
        return;
      }

      if (observerLazyTop.current) {
        console.log('[f] %c SHOULD DISCONNECT OBSERVER', 'color: #321553', {observer: observerLazyTop.current,
        topElm: observedElmTop.current,
        })
        observerLazyTop.current.unobserve(observedElmTop.current);
      }

      if (observerLazyBottom.current) {
        console.log('[f] %c SHOULD DISCONNECT OBSERVER', 'color: #321553', {observer: observerLazyBottom.current,
        bottomElm: observedElmBottom.current
        })
        // this.observerLazyBottom.current.unobserve(this.observedElmTop.current);
        observerLazyBottom.current.unobserve(observedElmBottom.current);
      }

      const observerCallback = (name) => getHandleIntersection((entry, observer) => {
        console.log(`[f] %c OBSERVER ${name} INTERSECTED CALLBACK`, 'color: #772323', {
          entry, 
          observer,
          lastChild,
          entryTarget: entry?.target,
          entryTargetDataset: entry?.target?.dataset,
        });

        if (entry.isIntersecting) {
          observer.disconnect();
          const blockKey = entry?.target?.dataset?.offsetKey?.split('-')?.[0];
          console.log(`[f] %c SETTING NEW BLOCK ${name} Target div is now in the viewport!`, 'color: #565432', {entry, observer, blockKey, firstChild, lastChild});
        // TODO: only set the currentLazyLoadKey to the block that's inside the lazy loaded blocks (no selection or first/last blocks)

          // this.setState({
          //   // shouldRecalculateLazyLoad: true,
          //   currentLazyLoadKey: blockKey
          // });

          setCurrentLazyLoadKey(blockKey);
        }
      })

      observerLazyTop.current = new IntersectionObserver(observerCallback('TOP'));
      observerLazyBottom.current = new IntersectionObserver(observerCallback('BOTTOM'));

      observedElmTop.current = firstChild;
      observedElmBottom.current = lastChild;

      observerLazyTop.current.observe(observedElmTop.current);
      // this.observerLazyBottom.current.observe(this.observedElmTop.current);
      observerLazyBottom.current.observe(observedElmBottom.current);

      console.log('[f] AFTER OBSERVER INIT', {observerBottom: observerLazyBottom.current, obsererTop: observerLazyTop.current, topElm: observedElmTop.current, bottomElm: observedElmBottom.current})
    }


  }, [outputBlockIndexes]);


  /*
   * Calculate indexes to render
   */

  React.useEffect(() => {
    const blocksAsArray = props.editorState.getCurrentContent().getBlocksAsArray();

    console.log('[f] %c USE LAYOUT EFFECT - CALC INDEXES', 'color: #888854', {currentLazyLoadKey, blocksAsArray, props})

    let outputBlockIndexes = [];
    
    if(currentLazyLoadKey > '' && initialCurrentLazyLoadKey !== currentLazyLoadKey) {
      outputBlockIndexes = getLazyLoadedBlockIndexes({editorState: props.editorState, blocks: blocksAsArray, initialBlockKey: currentLazyLoadKey})

        // // TODO: try and leave first and last block in the array
        // // TODO: earlier lazy loading
        // // TODO: for selection that is manual start and end => show them in the dom anyway even if they are "unloaded"
        // TODO: for scroll to ref - add an initial lazy block key as prop 

        // TODO: for hidden clauses - skip display:none blocks
        // TODO: try "display: none" instead of removing blocks from container
      } else if (!currentLazyLoadKey || initialCurrentLazyLoadKey === currentLazyLoadKey) {
        let lazyLoadBlocks = blocksAsArray.slice(0, MAX_BLOCKS_TO_DISPLAY + (LAZY_LOAD_OFFSET * 2));
        outputBlockIndexes = Array.from({length: lazyLoadBlocks.length}, (v, k) => k);
      }

      setOutputBlockIndexes(outputBlockIndexes);

      console.log('[f] LAYOUT FINISHED ', {outputBlockIndexes})

  }, [currentLazyLoadKey, props])

  // React.useEffect(() => {

  //   console.log('[f] useLayoutEffect - props', {currentLazyLoadKey, props})
    
  //   const {
  //     blockRenderMap,
  //     blockRendererFn,
  //     blockStyleFn,
  //     customStyleMap,
  //     customStyleFn,
  //     editorState,
  //     editorKey,
  //     preventScroll,
  //     textDirectionality,
  //   } = props;

  //   const blockKeyToScrollTo = '6i4hg';

  //   const content = editorState.getCurrentContent();
  //   const selection = editorState.getSelection();
  //   const forceSelection = editorState.mustForceSelection();
  //   const decorator = editorState.getDecorator();
  //   const directionMap = nullthrows(editorState.getDirectionMap());

  //   const blocksAsArray = content.getBlocksAsArray();
  //   const processedBlocks = [];
  //   const alreadyEncounteredDepth = new Set<number>();
  //   let currentDepth = null;
  //   let lastWrapperTemplate = null;

  //   for (let ii = 0; ii < blocksAsArray.length; ii++) {
  //     const block = blocksAsArray[ii];
  //     const key = block.getKey();
  //     const blockType = block.getType();

  //     const customRenderer = blockRendererFn(block);
  //     let CustomComponent, customProps, customEditable;
  //     if (customRenderer) {
  //       CustomComponent = customRenderer.component;
  //       customProps = customRenderer.props;
  //       customEditable = customRenderer.editable;
  //     }

  //     const direction = textDirectionality
  //       ? textDirectionality
  //       : directionMap.get(key);
  //     const offsetKey = DraftOffsetKey.encode(key, 0, 0);
  //     const componentProps = {
  //       contentState: content,
  //       block,
  //       blockProps: customProps,
  //       blockStyleFn,
  //       customStyleMap,
  //       customStyleFn,
  //       decorator,
  //       direction,
  //       forceSelection,
  //       offsetKey,
  //       preventScroll,
  //       selection,
  //       tree: editorState.getBlockTree(key),
  //     };

  //     const configForType = blockRenderMap.get(blockType) || blockRenderMap.get('unstyled');
  //     const wrapperTemplate = configForType.wrapper;

  //     const Element =
  //       configForType.element || blockRenderMap.get('unstyled').element;

  //     const depth = block.getDepth();
  //     let className = '';
  //     if (blockStyleFn) {
  //       className = blockStyleFn(block);
  //     }

  //     // List items are special snowflakes, since we handle nesting and
  //     // counters manually.
  //     if (Element === 'li') {
  //       const shouldResetCount =
  //         lastWrapperTemplate !== wrapperTemplate ||
  //         currentDepth === null ||
  //         depth > currentDepth ||
  //         (depth < currentDepth && !alreadyEncounteredDepth.has(depth));
  //       className = joinClasses(
  //         className,
  //         getListItemClasses(blockType, depth, shouldResetCount, direction),
  //       );
  //     }

  //     alreadyEncounteredDepth.add(depth);

  //     const Component = CustomComponent || DraftEditorBlock;
  //     let childProps = {
  //       className,
  //       'data-block': true,
  //       'data-editor': editorKey,
  //       'data-offset-key': offsetKey,
  //       key,
  //     };
  //     if (customEditable !== undefined) {
  //       childProps = {
  //         ...childProps,
  //         contentEditable: customEditable,
  //         suppressContentEditableWarning: true,
  //       };
  //     }

  //     const child = React.createElement(
  //       Element,
  //       childProps,
  //       <Component {...componentProps} key={key} />,
  //     );

  //     processedBlocks.push({
  //       block: child,
  //       wrapperTemplate,
  //       key,
  //       offsetKey,
  //     });

  //     if (wrapperTemplate) {
  //       currentDepth = block.getDepth();
  //     } else {
  //       currentDepth = null;
  //     }
  //     lastWrapperTemplate = wrapperTemplate;
  //   }

  //   // Get 25 blocks above and below currentLazyLoadKey
  //   let lazyLoadBlocks = [];
  //   if(currentLazyLoadKey > '' && initialCurrentLazyLoadKey !== currentLazyLoadKey) {
  //     lazyLoadBlocks = getLazyLoadedBlocks({editorState: props.editorState, blocks: processedBlocks, initialBlockKey: currentLazyLoadKey})

  //     // // TODO: try and leave first and last block in the array
  //     // // TODO: earlier lazy loading
  //     // // TODO: for selection that is manual start and end => show them in the dom anyway even if they are "unloaded"
  //     // TODO: for scroll to ref - add an initial lazy block key as prop 

  //     // TODO: for hidden clauses - skip display:none blocks
  //     // TODO: try "display: none" instead of removing blocks from container
  //   } else if (!currentLazyLoadKey || initialCurrentLazyLoadKey === currentLazyLoadKey) {
  //     lazyLoadBlocks = processedBlocks.slice(0, MAX_BLOCKS_TO_DISPLAY + (LAZY_LOAD_OFFSET * 2));
  //   }

  //   console.log('[f] The Lazy Block Loading Key:', currentLazyLoadKey, content.getBlockForKey(currentLazyLoadKey)?.text)

  //   // Group contiguous runs of blocks that have the same wrapperTemplate
  //   const outputBlocks = [];
  //   for (let ii = 0; ii < lazyLoadBlocks.length;) {
  //     const info: any = lazyLoadBlocks[ii];

  //     // console.log('[f] render inside checkubg - info', {info, ii});

  //     let block = null;

  //     if (info.wrapperTemplate) {
  //       const blocks = [];
  //       do {
  //         blocks.push(lazyLoadBlocks[ii].block);
  //         ii++;
  //       } while (
  //         ii < lazyLoadBlocks.length &&
  //         lazyLoadBlocks[ii].wrapperTemplate === info.wrapperTemplate
  //       );
  //       const wrapperElement = React.cloneElement(
  //         info.wrapperTemplate,
  //         {
  //           key: info.key + '-wrap',
  //           'data-offset-key': info.offsetKey,
  //         },
  //         blocks,
  //       );
  //       // outputBlocks.push(wrapperElement);

  //       block = wrapperElement;
  //     } else {
  //       // outputBlocks.push(info.block);
  //       block = info.block;
  //       ii++;
  //     }

  //     if (block) {
  //       outputBlocks.push(block);
  //       if (ii === processedBlocks.length || ii === lazyLoadBlocks.length) {
  //         console.log('[f] LAST BLOCK - add event listenr to block', {block});
  //       }
  //     }
  //   }

  //   setOutputBlocks(outputBlocks);
  // }, [
  //   currentLazyLoadKey, 
  //   props.editorState?.getCurrentContent?.(), 
  //   props.editorState?.getSelection?.(), 
  //   props.editorState?.mustForceSelection?.(), 
  //   props.editorState?.getDecorator?.(), 
  //   props.editorState?.getDirectionMap?.()
  //  ]
  // )

  /*
   * Render
   */ 

  console.log('[f] %c render - props', 'color: #777', {currentLazyLoadKey, props, outputBlockIndexes})
    
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

  const blockKeyToScrollTo = '6i4hg';

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
      console.log('[f] inserting lazy block (every 10th log)', {i, index: outputBlockIndexes[i], block: blocksAsArray[outputBlockIndexes[i]]})
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

  // let lazyLoadBlocks = [];
  // if(currentLazyLoadKey > '' && initialCurrentLazyLoadKey !== currentLazyLoadKey) {
  //   lazyLoadBlocks = getLazyLoadedBlocks({editorState: props.editorState, blocks: processedBlocks, initialBlockKey: currentLazyLoadKey})

  //   // // TODO: try and leave first and last block in the array
  //   // // TODO: earlier lazy loading
  //   // // TODO: for selection that is manual start and end => show them in the dom anyway even if they are "unloaded"
  //   // TODO: for scroll to ref - add an initial lazy block key as prop 

  //   // TODO: for hidden clauses - skip display:none blocks
  //   // TODO: try "display: none" instead of removing blocks from container
  // } else if (!currentLazyLoadKey || initialCurrentLazyLoadKey === currentLazyLoadKey) {
  //   lazyLoadBlocks = processedBlocks.slice(0, MAX_BLOCKS_TO_DISPLAY + (LAZY_LOAD_OFFSET * 2));
  // }

  // for (let i = 0; i < outputBlockIndexes.length; i++) {
    
  //   if (i % 10 === 0) {
  //     console.log('[f] inserting lazy block (every 10th log)', {i, index: outputBlockIndexes[i], block: processedBlocks[outputBlockIndexes[i]]})
  //   }
  //   const block = processedBlocks[outputBlockIndexes[i]];
  //   if (block) {
  //     lazyLoadBlocks.push(block);
  //   }
  // }

  console.log('[f] render after processing:', {currentLazyLoadKey, contextText: content.getBlockForKey(currentLazyLoadKey)?.text, 
    processedBlocks, outputBlockIndexes, lazyLoadBlocks, blocksAsArray })

  // Group contiguous runs of blocks that have the same wrapperTemplate
  const outputBlocks = [];
  for (let ii = 0; ii < processedBlocks.length;) {
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
        console.log('[f] LAST BLOCK - add event listenr to block', {block});
      }
    }
  }

  console.log('[f] final outputBlocks', {outputBlocks})


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

  console.log('[f] shouldComponentUpdate IN DraftEditorContents-core.react.js', {prevProps, nextProps, nextBlockMapArr: nextProps?.editorState?.getCurrentContent()?.getBlockMap()?.toArray()});

  const prevEditorState = prevProps.editorState;
  const nextEditorState = nextProps.editorState;

  const prevDirectionMap = prevEditorState.getDirectionMap();
  const nextDirectionMap = nextEditorState.getDirectionMap();

  // Text direction has changed for one or more blocks. We must re-render.
  if (prevDirectionMap !== nextDirectionMap) {
    console.log('[f] return false 1')
    return false;
  }

  const didHaveFocus = prevEditorState.getSelection().getHasFocus();
  const nowHasFocus = nextEditorState.getSelection().getHasFocus();

  if (didHaveFocus !== nowHasFocus) {
    console.log('[f] return false 2')
    return false;
  }

  const nextNativeContent = nextEditorState.getNativelyRenderedContent();

  const wasComposing = prevEditorState.isInCompositionMode();
  const nowComposing = nextEditorState.isInCompositionMode();
  
  // const prevState = this.state;
  // const stateChanged = prevState !== nextState;

  // If the state is unchanged or we're currently rendering a natively
  // rendered state, there's nothing new to be done.
  if (
    prevEditorState === nextEditorState ||
      (nextNativeContent !== null && nextEditorState.getCurrentContent() === nextNativeContent) ||
      (wasComposing && nowComposing)
  ) {
    console.log('[f] RETURNING TRUE 1', {wasComposing, nowComposing});
    return true;
  }

  const prevContent = prevEditorState.getCurrentContent();
  const nextContent = nextEditorState.getCurrentContent();
  const prevDecorator = prevEditorState.getDecorator();
  const nextDecorator = nextEditorState.getDecorator();

  console.log('[f] SHOULD SKIP? FINAL STEP', {
    result: wasComposing === nowComposing &&
    prevContent === nextContent &&
    prevDecorator === nextDecorator &&
    !nextEditorState.mustForceSelection(),
  })

  return (
    wasComposing === nowComposing &&
    prevContent === nextContent &&
    prevDecorator === nextDecorator &&
    !nextEditorState.mustForceSelection()
  );
});

// export default DraftEditorContents;
module.exports = DraftEditorContents;