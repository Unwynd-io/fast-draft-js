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

  /*
   * Handle sections - remove blocks that are inside collapsed sections, handle last block
   */

  let shouldSkipBlocks = false;
  let blocks = [];

  for (let i = 0; i < _blocks.length; i++) {
    
    const block = _blocks[i];
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
    blocks.push(block)
  }

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

  /*
   * Calculate lazy blocks
   */ 

  const BLOCK_RANGE = Math.floor(MAX_LAZY_LOAD_BLOCKS / 2);

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

  /*
   * Map the lazy blocks
   */

  const FIRST_BLOCK = 0;
  const LAST_BLOCK = blocks.length - 1;

  if (start > FIRST_BLOCK) {
    lazyLoadBlockIndexes.push(FIRST_BLOCK);
  }

  // Start selection off screen (ABOVE)
  if (startSelectionExists && (_startOffsetBlockIndex < start && _startOffsetBlockIndex !== FIRST_BLOCK)) {
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (ABOVE)
  if (endSelectionExists && ((_endOffsetBlockIndex < start && _endOffsetBlockIndex !== FIRST_BLOCK)
    && _endOffsetBlockIndex !== _startOffsetBlockIndex)) {
    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  // Loading the slice of blocks
  for (let i = start; i < end; i++) {
    const block = blocks[i];
    lazyLoadBlockIndexes.push(block.originalIndex);
  }

  // Start selection off screen (BELOW)
  if (startSelectionExists && (_startOffsetBlockIndex > end && _startOffsetBlockIndex !== LAST_BLOCK)) {
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (BELOW)
  if (endSelectionExists &&  ((_endOffsetBlockIndex > end && _endOffsetBlockIndex !== LAST_BLOCK)
    && _endOffsetBlockIndex !== _startOffsetBlockIndex)) {
    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  if (end < LAST_BLOCK + 1) {
    lazyLoadBlockIndexes.push(_blocks.length - 1);
  }

  return lazyLoadBlockIndexes;
}

module.exports = getLazyLoadedBlockIndexes;