// Constants
const { 
  LAZY_LOAD_BLOCK_OFFSET,
  MAX_LAZY_LOAD_BLOCKS,
} = require('LazyLoadingConstants');

function mapFilteredBlock (block, {index, isSection, hidden}) {
  block.originalIndex = index;
  block.isSection = isSection;
  block.hidden = typeof hidden === 'boolean' ? hidden : false;
  return block;
}

function getLazyLoadedBlockIndexes ({editorState, blocks: _blocks, initialBlockKey}) {

  console.log('[lazy] %c getLazyLoadedBlockIndexes', 'color: orange;', {editorState,
    selectionPlain: {
      anchorKey: editorState.getSelection().getAnchorKey(),
      focusKey: editorState.getSelection().getFocusKey(),
      anchorOffset: editorState.getSelection().getAnchorOffset(),
      focusOffset: editorState.getSelection().getFocusOffset(),
      isBackward: editorState.getSelection().getIsBackward(),
      startKEy: editorState.getSelection().getStartKey(),
      endKey: editorState.getSelection().getEndKey(),
    },
    selectionJS: editorState.getSelection().toJS(),
    selectionSER: editorState.getSelection().serialize(), _blocks, initialBlockKey})

  /*
   * Handle sections - remove blocks that are inside collapsed sections, handle last block
   */

  let shouldSkipBlocks = false;
  let blocks = [];

  for (let i = 0; i < _blocks.length; i++) {
    
    let block = _blocks[i];
    const blockType = block.getType();
    const blockDepth = block.getDepth();

    // TODO: try to make it so we do not alter the blocks directly 

    block = mapFilteredBlock(block, {index: i, isSection: blockType === 'ordered-list-item'});

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
    const blockType = lastOriginalBlock.getType();
    const block = mapFilteredBlock(lastOriginalBlock, {index: _blocks.length - 1, isSection: blockType === 'ordered-list-item', hidden: true});
    console.log('[lazy] LAST BLOCK IS HIDDEN - ', {blockMapped: block, lastOriginalBlock, lastFilteredBlock, blocks})
    blocks.push(block)
  }

  console.log('[lazy] filtered blocks', {blocks})

  let lazyLoadBlockIndexes = [];

  const editorSelection = editorState.getSelection();
  const _startOffsetBlockIndex = _blocks.findIndex(block => block.key === editorSelection.getStartKey()); // Indexes of blocks in filtered array
  const _endOffsetBlockIndex = _blocks.findIndex(block => block.key === editorSelection.getEndKey()); // Indexes of blocks in filtered array
  const startSelectionExists = _startOffsetBlockIndex !== -1;
  const endSelectionExists = _endOffsetBlockIndex !== -1;

  let startOffsetBlockIndex = 0; // Actual indexes of blocks in blockMap
  let endOffsetBlockIndex = 0; // Actual indexes of blocks in blockMap

  if (startSelectionExists) {
    startOffsetBlockIndex = _blocks[_startOffsetBlockIndex].originalIndex;
  }

  if (endSelectionExists) {
    endOffsetBlockIndex = _blocks[_endOffsetBlockIndex].originalIndex;
  }

  const lazyLoadBlockIndex = blocks.findIndex(block => block.key === initialBlockKey);

  /*
   * Calculate lazy blocks
   */ 

  const BLOCK_RANGE = Math.floor(MAX_LAZY_LOAD_BLOCKS / 2);

  // Start and end indexes for the lazy load array of blocks
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
    start = end - MAX_LAZY_LOAD_BLOCKS;

    if (start < 0) {
      start = 0;
    }
  }

  const startIndexOriginal = blocks[start].originalIndex;
  const endIndexOriginal = blocks[end].originalIndex;

  console.log('[lazy] data: ', {start, end, startIndexOriginal, endIndexOriginal, lazyLoadBlockIndex,})
  console.log('[lazy] selection data: ', { startOffsetBlockIndex, endOffsetBlockIndex, _startOffsetBlockIndex, _endOffsetBlockIndex, startSelectionExists, endSelectionExists })

  /*
   * Map the lazy blocks
   */

  const FIRST_BLOCK = 0;
  const LAST_BLOCK = blocks.length - 1;

  if (start > FIRST_BLOCK) {
    console.log('[lazy] %c pushing first block', 'color: #952162', {start, FIRST_BLOCK, indexPUSHED: FIRST_BLOCK});
    lazyLoadBlockIndexes.push(FIRST_BLOCK);
  }

  // Start selection off screen (ABOVE)
  if (startSelectionExists && (startOffsetBlockIndex < startIndexOriginal && startOffsetBlockIndex !== FIRST_BLOCK)) {
    console.log('[lazy] %c Start selection off screen (ABOVE)', 'color: #952162', { startOffsetBlockIndexPUSHED: startOffsetBlockIndex, _startOffsetBlockIndex, start, FIRST_BLOCK});
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (ABOVE)
  if (endSelectionExists && ((endOffsetBlockIndex < startIndexOriginal && endOffsetBlockIndex !== FIRST_BLOCK)
    && endOffsetBlockIndex !== startOffsetBlockIndex)) {
    console.log('[lazy] %c End selection off screen (ABOVE)', 'color: #952162', { endOffsetBlockIndexPUSHED: endOffsetBlockIndex, _endOffsetBlockIndex, _startOffsetBlockIndex, start, FIRST_BLOCK});
    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  let tempBlocks = [];

  // Loading the slice of blocks
  for (let i = start; i < end; i++) {
    const block = blocks[i];
    lazyLoadBlockIndexes.push(block.originalIndex);
    tempBlocks.push(block.originalIndex);
  }

  console.log('[lazy] %c pushed regular blocks', {tempBlocks})

  // Start selection off screen (BELOW)
  if (startSelectionExists && (startOffsetBlockIndex > endIndexOriginal && startOffsetBlockIndex !== LAST_BLOCK)) {
    console.log('[lazy] %c Start selection off screen (BELOW)', 'color: #952162', { startOffsetBlockIndexPUSHED: startOffsetBlockIndex, _startOffsetBlockIndex, end, LAST_BLOCK})
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (BELOW)
  if (endSelectionExists &&  ((endOffsetBlockIndex > endIndexOriginal && endOffsetBlockIndex !== LAST_BLOCK)
    && endOffsetBlockIndex !== startOffsetBlockIndex)) {

    console.log('[lazy] %c End selection off screen (BELOW)', 'color: #952162', { endOffsetBlockIndexPUSHED: endOffsetBlockIndex, _endOffsetBlockIndex, _startOffsetBlockIndex, end, LAST_BLOCK})

    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  if (end < LAST_BLOCK + 1) {
    console.log('[lazy] %c pushing last block', 'color: #952162', {end, LAST_BLOCK, indexPUSHED: _blocks.length - 1});
    lazyLoadBlockIndexes.push(_blocks.length - 1);
  }

  console.log('------------------')

  return lazyLoadBlockIndexes;
}

module.exports = getLazyLoadedBlockIndexes;