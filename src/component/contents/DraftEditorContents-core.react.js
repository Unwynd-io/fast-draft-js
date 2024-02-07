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
    // if (entry.isIntersecting) {
    //   // const blockKey = entry?.target?.dataset?.offsetKey?.split('-')?.[0];
    //   // console.log('[f] Target div is now in the viewport!', {entry, observer, blockKey});
    //   callback();
    //   observer.disconnect();

    //   // this.setState({
    //   //   currentLazyLoadKey: blockKey
    //   // });
    // }
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
      currentLazyLoadKey: null
    }
    this.contentsRef = React.createRef(null);

    // Lazy load observers
    this.observerLazyTop = React.createRef(null);
    this.observerLazyBottom = React.createRef(null);
    this.observedElmTop = React.createRef(null);
    this.observedElmBottom = React.createRef(null);
 }

  shouldComponentUpdate(nextProps: Props, nextState): boolean {

    console.log('[f] shouldComponentUpdate IN DraftEditorContents-core.react.js', {nextState, currentState: this.state, shouldUpdateObserver: this.state.currentLazyLoadKey !== nextState.currentLazyLoadKey, nextBlockMapArr: nextProps?.editorState?.getCurrentContent()?.getBlockMap()?.toArray()});

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
    const stateChanged = prevState.currentLazyLoadKey !== nextState.currentLazyLoadKey;

    // If the state is unchanged or we're currently rendering a natively
    // rendered state, there's nothing new to be done.
    if (
      !stateChanged && 
      (prevEditorState === nextEditorState ||
        (nextNativeContent !== null &&
          nextEditorState.getCurrentContent() === nextNativeContent) ||
        (wasComposing && nowComposing))
    ) {
      console.log('[f] RETURNING FALSE 1', {wasComposing, nowComposing});
      return false;
    }

    const prevContent = prevEditorState.getCurrentContent();
    const nextContent = nextEditorState.getCurrentContent();
    const prevDecorator = prevEditorState.getDecorator();
    const nextDecorator = nextEditorState.getDecorator();

    console.log('[f] SHOULD UPDATE? FINAL STEP', {
      result: wasComposing !== nowComposing ||
      prevContent !== nextContent ||
      prevDecorator !== nextDecorator ||
      nextEditorState.mustForceSelection() || 
      stateChanged,

      currentState: this.state,
      nextState,
    })

    return (
      wasComposing !== nowComposing ||
      prevContent !== nextContent ||
      prevDecorator !== nextDecorator ||
      nextEditorState.mustForceSelection() ||
      stateChanged
    );
  }
  
  componentDidMount() {
    // Function to be called when the target div is in the viewport
    const currentBlockMap = this?.props?.editorState?.getCurrentContent()?.getBlockMap()?.toArray();
    console.log('[f] componentdidMount, v1.3', {currentBlockMap, props: this.props})
  }

  componentDidUpdate(prevProps, prevState) {
    const currentState = this.state;
    const currentBlockMap = this?.props?.editorState?.getCurrentContent()?.getBlockMap()?.toArray();
    console.log('[f] %c componentDidUpdate, ', 'color: #123153', {currentBlockMap, currentProps: this.props, currentState, prevProps, prevState, topElm: this.observedElmTop.current, bottomElm: this.observedElmBottom.current, observerTop: this.observerLazyTop.current, observerBottom: this.observerLazyBottom.current,
    })
    
    // const handleIntersection = (entries, observer) => {
    //   console.log('[f] props of intersection', {entries, observer})

    //   entries.forEach(entry => {
    //     if (entry.isIntersecting) {
    //       const blockKey = entry?.target?.dataset?.offsetKey?.split('-')?.[0];
    //       console.log('[f] Target div is now in the viewport!', {entry, observer, blockKey});
    //       observer.disconnect();

    //       this.setState({
    //         currentLazyLoadKey: blockKey
    //       });
    //     }
    //   });
    // }
  
    // const startObserver = (retry: boolean) => {
    //   // Create an intersection observer with the callback function
    //   const observerTop = new IntersectionObserver(handleIntersection);
    //   const observerBottom = new IntersectionObserver(handleIntersection);
    //   // Target the div you want to observe
      
    //   let lastChild = this.contentsRef?.current?.lastChild;
    //   if(!lastChild) {

    //     console.log('[f] NO LAST CHILD - contents: ', {
    //       contentsBox: this.contentsRef?.current,
    //       children: this.contentsRef?.current?.children,
    //       childrenCount: this.contentsRef?.current?.children?.length
    //     })

    //     if(retry) {
    //       // const test = document.querySelector(`[data-editor]`)?.parentNode?.parentNode
    //       console.log('cannot find contentsRef after 1 retry', this.contentsRef?.current, /*test*/)
    //       return;
    //     }
    //     return setTimeout(() => startObserver(true), 1000)
    //   }
    //   const targetTopDiv = this.contentsRef.current.firstChild;

    //   const childThreeFromBottom = this.contentsRef.current[this.contentsRef.current.length-3];
    //   const targetBottomDiv = childThreeFromBottom ? childThreeFromBottom : this.contentsRef.current.lastChild;

    //   console.log('[f] targetDivs', {targetTopDiv, targetBottomDiv});

    //   // Start observing the target div
    //   observerTop.observe(targetTopDiv);
    //   observerBottom.observe(targetBottomDiv);
    // }


    if (!this.observerLazyBottom.current || !this.observerLazyTop.current || prevState.currentLazyLoadKey !== currentState.currentLazyLoadKey) {
      // let firstChild = getNextSibling(getFirstDraftBlock(this.contentsRef?.current?.firstChild, true), LAZY_LOAD_OFFSET);
      
      let firstChild = getNextSibling(this.contentsRef?.current?.firstChild, LAZY_LOAD_OFFSET, (elm) => getFirstDraftBlock(elm, true));
      let lastChild = getPreviousSibling(this.contentsRef?.current?.lastChild, LAZY_LOAD_OFFSET, (elm) => getFirstDraftBlock(elm, false));

      console.log('[f] %c OBSERVING NEW', 'color: #532523', {
        wasKey: prevState.currentLazyLoadKey,
        nowKey: currentState.currentLazyLoadKey,
        observerTop: this.observerLazyTop.current,
        observerBottom: this.observerLazyBottom.current,
        firstChild,
        lastChild
      })
      // startObserver(false);

      if(!firstChild || !lastChild) {
        console.log('[f] %c NO FIRST OR LAST CHILD', 'color: red', {firstChild, lastChild})
        return;
      }

      if (this.observerLazyTop.current) {
        console.log('[f] %c SHOULD DISCONNECT OBSERVER', 'color: #321553', {observer: this.observerLazyTop.current,
        topElm: this.observedElmTop.current,
        })
        this.observerLazyTop.current.unobserve(this.observedElmTop.current);
      }

      if (this.observerLazyBottom.current) {
        console.log('[f] %c SHOULD DISCONNECT OBSERVER', 'color: #321553', {observer: this.observerLazyBottom.current,
        bottomElm: this.observedElmBottom.current
        })
        // this.observerLazyBottom.current.unobserve(this.observedElmTop.current);
        this.observerLazyBottom.current.unobserve(this.observedElmBottom.current);
      }

      const observerCallback = (name) => getHandleIntersection((entry, observer) => {
        console.log(`[f] %c OBSERVER ${name} INTERSECTED CALLBACK`, 'color: #772323', {
          wasKey: prevState.currentLazyLoadKey,
          nowKey: currentState.currentLazyLoadKey,
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

          this.setState({
            currentLazyLoadKey: blockKey
          });
        }
      })

      this.observerLazyTop.current = new IntersectionObserver(observerCallback('TOP'));
      this.observerLazyBottom.current = new IntersectionObserver(observerCallback('BOTTOM'));

      this.observedElmTop.current = firstChild;
      this.observedElmBottom.current = lastChild;

      this.observerLazyTop.current.observe(this.observedElmTop.current);
      // this.observerLazyBottom.current.observe(this.observedElmTop.current);
      this.observerLazyBottom.current.observe(this.observedElmBottom.current);

      console.log('[f] AFTER OBSERVER INIT', {observerBottom: this.observerLazyBottom.current, obsererTop: this.observerLazyTop.current, topElm: this.observedElmTop.current, bottomElm: this.observedElmBottom.current})
    }
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

    const { currentLazyLoadKey } = this.state;

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

    for (let ii = 0; ii < blocksAsArray.length; ii++) {
      const block = blocksAsArray[ii];
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

    // Get 25 blocks above and below currentLazyLoadKey
    let lazyLoadBlocks = [];
    if(currentLazyLoadKey) {
      lazyLoadBlocks = [];

      const startOffsetBlockIndex = processedBlocks.findIndex(block => block.key === this.props.editorState.getSelection().getStartKey());
      const endOffsetBlockIndex = processedBlocks.findIndex(block => block.key === this.props.editorState.getSelection().getEndKey());

      const lazyLoadBlockIndex = processedBlocks.findIndex(block => block.key === currentLazyLoadKey);

      console.log('[f] INTIIAL CURRENT INDEX', {lazyLoadBlockIndex, startOffsetBlockIndex, endOffsetBlockIndex, blockOnIndex: processedBlocks[lazyLoadBlockIndex], currentLazyLoadKey, processedBlocks, })

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

      if (end > processedBlocks.length) {
        end = processedBlocks.length;
        start = end - MAX_BLOCKS_TO_DISPLAY;

        if (start < 0) {
          start = 0;
        }
      }

      console.log('[f] %c calc lazy load blocks', 'color: #163432', {start, end, difference, startOffsetBlockIndex, endOffsetBlockIndex});

      /*
       * Map the lazy blocks
       */

      const lazySlice = processedBlocks.slice(start, end);
      const FIRST_BLOCK = 0;
      const LAST_BLOCK = processedBlocks.length - 1;

      if (start > FIRST_BLOCK) {
        console.log('[f] start > FIRST_BLOCK, adding first block')
        lazyLoadBlocks.push(processedBlocks[FIRST_BLOCK]);
      }

      // Start selection off screen (ABOVE)
      if ((startOffsetBlockIndex < start && startOffsetBlockIndex !== FIRST_BLOCK)) {
        console.log('[f] loading START selection off screen ABOVE')
        lazyLoadBlocks.push(processedBlocks[startOffsetBlockIndex]);
      }

      // End selection off screen (ABOVE)
      if ((endOffsetBlockIndex < start && endOffsetBlockIndex !== FIRST_BLOCK)
      && endOffsetBlockIndex !== startOffsetBlockIndex) {
        console.log('[f] loading END selection off screen ABOVE')
        lazyLoadBlocks.push(processedBlocks[endOffsetBlockIndex]);
      }

      // Loading the slice
      lazyLoadBlocks = lazyLoadBlocks.concat(lazySlice);

      // Start selection off screen (BELOW)
      if (startOffsetBlockIndex > end && startOffsetBlockIndex !== LAST_BLOCK) {
        console.log('[f] loading START selection off screen BELOW')
        lazyLoadBlocks.push(processedBlocks[startOffsetBlockIndex]);
      }

      // End selection off screen (BELOW)
      if ((endOffsetBlockIndex > end && endOffsetBlockIndex !== LAST_BLOCK)
        && endOffsetBlockIndex !== startOffsetBlockIndex) {
        console.log('[f] loading END selection off screen BELOW')
        lazyLoadBlocks.push(processedBlocks[endOffsetBlockIndex]);
      }

      if (end < LAST_BLOCK + 1) {
        console.log('[f] end < LAST_BLOCK, loading last block')
        lazyLoadBlocks.push(processedBlocks[LAST_BLOCK]);
      }


      // // TODO: try and leave first and last block in the array
      // // TODO: earlier lazy loading
      // // TODO: for selection that is manual start and end => show them in the dom anyway even if they are "unloaded"
      // TODO: for scroll to ref - add an initial lazy block key as prop 

      // TODO: for hidden clauses - skip display:none blocks
      // TODO: try "display: none" instead of removing blocks from container
    } else {
      lazyLoadBlocks = processedBlocks.slice(0, MAX_BLOCKS_TO_DISPLAY + (LAZY_LOAD_OFFSET * 2));
    }

    console.log('[f] The Lazy Block Loading Key:', currentLazyLoadKey, content.getBlockForKey(currentLazyLoadKey)?.text)

    // Group contiguous runs of blocks that have the same wrapperTemplate
    const outputBlocks = [];
    for (let ii = 0; ii < lazyLoadBlocks.length;) {
      const info: any = lazyLoadBlocks[ii];

      // console.log('[f] render inside checkubg - info', {info, ii});

      let block = null;

      if (info.wrapperTemplate) {
        const blocks = [];
        do {
          blocks.push(lazyLoadBlocks[ii].block);
          ii++;
        } while (
          ii < lazyLoadBlocks.length &&
          lazyLoadBlocks[ii].wrapperTemplate === info.wrapperTemplate
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
        if (ii === processedBlocks.length || ii === lazyLoadBlocks.length) {
          console.log('[f] LAST BLOCK - add event listenr to block', {block});
        }
      }
    }

    console.log('[f] render inside - props', {outputBlocks});

    return <div data-contents="true" ref={this.contentsRef}>{outputBlocks}</div>;
  }
}

module.exports = DraftEditorContents;
