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

// Constants
const { 
  DEFAULT_DRAFT_BLOCK_HEIGHT,
  LAZY_LOAD_BLOCK_OFFSET,
  MAX_LAZY_LOAD_BLOCKS,
  MAX_BLOCKS_TO_DISPLAY  
} = require('LazyLoadingConstants');

// Utils
import { findDOMNode } from 'react-dom';
const getLazyLoadedBlockIndexes = require('getLazyLoadedBlockIndexes');
const { getBlockByKey, getFirstDraftBlock, getNextSibling, getPreviousSibling } = require('blockMethods');


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

  handleFocusBlock = blockKey => {
    const block = getBlockByKey(blockKey);

    if (block) {
      block.scrollIntoView({behavior: 'instant', block: 'center'});
    }
  };

  handleUnobserve = (observer, element) => {
    if (observer) {
      observer.unobserve(element);
    }
  };

  handleUpdateScrollPosition = ({
    currentLazyLoad,
    firstChild,
    lastChild,
    firstChildParamsBefore,
    lastChildParamsBefore,
  }) => {
    let newScrollPosition = null;

    let oldRects, newRects;

    if (!!firstChild && currentLazyLoad.direction === 'TOP') {
      oldRects = firstChildParamsBefore;
      newRects = firstChild.getBoundingClientRect?.();

      // Backup when DOM styles are not fully calculated
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
      }
    } else if (!!lastChild && currentLazyLoad.direction === 'BOTTOM') {
      oldRects = lastChildParamsBefore;
      newRects = lastChild.getBoundingClientRect();
    }

    if (
      !!newRects &&
      !!oldRects &&
      newRects?.top !== 0 &&
      oldRects?.top !== newRects?.top
    ) {
      const currentScroll = this.contentsRef.current.parentElement.scrollTop;
      newScrollPosition = currentScroll + (newRects.top - oldRects.top);
    }

    if (newScrollPosition) {
      const scrollElm = this.contentsRef.current.parentElement;
      scrollElm.scrollTop = newScrollPosition;
    }
  };

  handleCreateObservers = () => {
    let firstChild = getTopObservableBlock(
      this.contentsRef?.current?.firstChild,
    );
    let lastChild = getBottomObservableBlock(
      this.contentsRef?.current?.lastChild,
    );

    if (!firstChild || !lastChild) {
      return;
    }

    let oldRectsParamsTop = this.observedElmTopParams.current;
    let oldRectsParamsBottom = this.observedElmBottomParams.current;

    // The initial load - no previous values
    if (!oldRectsParamsTop) {
      oldRectsParamsTop = this.observedElmTop.current?.getBoundingClientRect();
    }
    if (!oldRectsParamsBottom) {
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

    const observerCallback = direction => (entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          observer.disconnect();
          const blockKey = entry?.target?.dataset?.offsetKey?.split('-')?.[0];
          this.setState({
            ...this.state,
            currentLazyLoad: {
              key: blockKey,
              direction,
            },
          });
        }
      });
    }

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
  };

  handleEditorScroll = e => {
    const scrollElm = this.contentsRef.current.parentElement;
    const currentScroll = scrollElm.scrollTop;

    if (!this.isTopOfPage.current) {
      if (currentScroll < this.topBlocksOffsetHeight.current) {
        scrollElm.scrollTop = this.topBlocksOffsetHeight.current;
      }
    }
  };

  shouldComponentUpdate(nextProps: Props, nextState): boolean {
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
      MAX_BLOCKS_TO_DISPLAY,
    );

    let outputBlockIndexes = Array.from(
      {length: lazyLoadBlocks.length},
      (v, k) => k,
    );
    
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
      // Saving the blocks position before they are re-rendered to a new place after the DOM is updated - to calculate the scroll position
      const topElm = this.observedElmTop.current;
      const bottomElm = this.observedElmBottom.current;

      const observerElmTopRects = topElm?.getBoundingClientRect?.();
      const observerElmBottomRects = bottomElm?.getBoundingClientRect?.();

      this.observedElmTopParams.current = observerElmTopRects;
      this.observedElmBottomParams.current = observerElmBottomRects;
    }

    return null;
  }

  componentDidUpdate(prevProps, prevState, snapshot) {

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

      let areIndexesSorted = false;

      if (this.state.currentLazyLoad.key > '') {

        outputBlockIndexes = getLazyLoadedBlockIndexes({
          editorState: this.props.editorState,
          blocks: blocksAsArray,
          initialBlockKey: this.state.currentLazyLoad.key,
        });
        
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
      } else if (!this.state.currentLazyLoad.key) {
        let lazyLoadBlocks = blocksAsArray.slice(
          0,
          MAX_BLOCKS_TO_DISPLAY,
        );
        outputBlockIndexes = Array.from(
          {length: lazyLoadBlocks.length},
          (v, k) => k,
        );
        
        this.setState({
          ...this.state,
          outputBlockIndexes,
        });
        areIndexesSorted = true;
      }

      this.isTopOfPage.current = areIndexesSorted;
    }

    /*
     * Events on indexes change
     */

    if (prevState.outputBlockIndexes !== outputBlockIndexes) {
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
      const shouldLazyLoad = outputBlockIndexes.length > MAX_LAZY_LOAD_BLOCKS;

      /*
       * Calculate blocks offset
       */

      if (isDOMUpdated) {
        let topBlocksOffsetHeight = DEFAULT_DRAFT_BLOCK_HEIGHT; // Fallback value

        if (!!this.contentsRef?.current?.firstChild) {
          const draftElm = getFirstDraftBlock(this.contentsRef?.current?.firstChild, true);

          if (draftElm) {
            topBlocksOffsetHeight = draftElm.offsetHeight;
          }

          this.topBlocksOffsetHeight.current = topBlocksOffsetHeight;
        }
      }

      /*
       * Refresh the observers on scroll
      */
      if (
        this.canObserve.current &&
        shouldLazyLoad &&
        !!this.contentsRef?.current?.lastChild &&
        isDOMUpdated
      ) {
        this.handleCreateObservers();
      }
    }

    /*
     * Focus on the block
     */

    const blockKeyToScrollTo = this.props.editorState.getBlockKeyToScrollTo();
    let currentFocusBlockKey = this.state.currentFocusBlockKey;

    if (blockKeyToScrollTo !== prevProps.editorState.getBlockKeyToScrollTo()) {
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

          this.canObserve.current = false;

          currentFocusBlockKey = blockKeyToScrollTo;
          
          this.setState({
            ...this.state,
            currentFocusBlockKey,
            currentLazyLoad: {key: currentFocusBlockKey, direction: 'FOCUS'},
          });
        } else {
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
      if (
        this.state.currentFocusBlockKey > '' &&
        !!getBlockByKey(this.state.currentFocusBlockKey)
      ) {
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
        block = wrapperElement;
      } else {
        block = info.block;
        ii++;
      }

      if (block) {
        outputBlocks.push(block);
      }
    }
    
    return (
      <div data-contents="true" ref={this.contentsRef}>
        {outputBlocks}
      </div>
    );
  }
}


// // TODO: refactor code in this component: move out util methods and constants, remove comments, improve code

// TODO: test scrollToRef and other use-cases
// TODO: test this: only set the currentLazyLoad to the block that's inside the lazy loaded blocks (no selection or first/last blocks) - what happens if selection is on currentLazyLoad.key block
// TODO: improve performance on backspace (see why it happens and do not recalulate the indexes unless blockMap changes)
// TODO: try to fix blockKeyToScrollTo (reset in the editor) or add timestamp tracking
// TODO: style the clauses
// TODO: move the package to a private repositry
// TODO: publish private (or public) package
// TODO: look into tooltips and editor preview
// TODO: (optional) try to implement our own scrollbar

module.exports = DraftEditorContents;