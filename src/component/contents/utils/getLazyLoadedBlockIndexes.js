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

  /*
   * The last and first blocks are always loaded (regardless whether they are visible on the screen or not) but we need to "display:none" the last block if it's in a hidden clause since we don't want to see it on the screen 
   */

  if (lastOriginalBlock.getKey() !== lastFilteredBlock.getKey()) {
    const blockType = lastOriginalBlock.getType();
    const block = mapFilteredBlock(lastOriginalBlock, {index: _blocks.length - 1, isSection: blockType === 'ordered-list-item', hidden: true});
    blocks.push(block)
  }


  let lazyLoadBlockIndexes = []; // Only the original indexes from the blockMap should be pushed 

  const editorSelection = editorState.getSelection();
  const startOffsetBlockIndex = _blocks.findIndex(block => block.key === editorSelection.getStartKey()); // Indexes of blocks in filtered array
  const endOffsetBlockIndex = _blocks.findIndex(block => block.key === editorSelection.getEndKey()); // Indexes of blocks in filtered array
  const startSelectionExists = startOffsetBlockIndex !== -1;
  const endSelectionExists = endOffsetBlockIndex !== -1;

  const lazyLoadBlockIndex = blocks.findIndex(block => block.key === initialBlockKey);

  /*
   * Calculate lazy blocks
   */ 

  const BLOCK_RANGE = Math.floor(MAX_LAZY_LOAD_BLOCKS / 2);

  // Start and end indexes for the lazy load array of blocks
  let start = lazyLoadBlockIndex - BLOCK_RANGE - LAZY_LOAD_BLOCK_OFFSET;
  let end = lazyLoadBlockIndex + BLOCK_RANGE + LAZY_LOAD_BLOCK_OFFSET;

  let difference = 0;
  const FIRST_BLOCK = 0;
  const LAST_BLOCK = blocks.length - 1;

  if (start < FIRST_BLOCK) {
    difference = Math.abs(start);
    start = FIRST_BLOCK;
    end += difference;
  }

  if (end > LAST_BLOCK) {
    end = LAST_BLOCK;
    start = end - MAX_LAZY_LOAD_BLOCKS;

    if (start < FIRST_BLOCK) {
      start = FIRST_BLOCK;
    }
  }

  const startIndexOriginal = blocks[start].originalIndex;
  const endIndexOriginal = blocks[end].originalIndex;


  /*
   * Map the lazy blocks
   */


  if (start > FIRST_BLOCK) {
    lazyLoadBlockIndexes.push(FIRST_BLOCK);
  }

  // Start selection off screen (ABOVE)
  if (startSelectionExists && (startOffsetBlockIndex < startIndexOriginal && startOffsetBlockIndex !== FIRST_BLOCK)) {
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (ABOVE)
  if (endSelectionExists && ((endOffsetBlockIndex < startIndexOriginal && endOffsetBlockIndex !== FIRST_BLOCK)
    && endOffsetBlockIndex !== startOffsetBlockIndex)) {
    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  let tempBlocks = [];

  // Loading the slice of blocks
  for (let i = start; i <= end; i++) {
    const block = blocks[i];
    lazyLoadBlockIndexes.push(block.originalIndex);
    tempBlocks.push(block.originalIndex);
  }


  // Start selection off screen (BELOW)
  if (startSelectionExists && (startOffsetBlockIndex > endIndexOriginal && startOffsetBlockIndex !== LAST_BLOCK)) {
    lazyLoadBlockIndexes.push(startOffsetBlockIndex);
  }

  // End selection off screen (BELOW)
  if (endSelectionExists &&  ((endOffsetBlockIndex > endIndexOriginal && endOffsetBlockIndex !== LAST_BLOCK)
    && endOffsetBlockIndex !== startOffsetBlockIndex)) {


    lazyLoadBlockIndexes.push(endOffsetBlockIndex);
  }

  if (end < LAST_BLOCK) {
    lazyLoadBlockIndexes.push(_blocks.length - 1);
  }


  return lazyLoadBlockIndexes;
}

module.exports = getLazyLoadedBlockIndexes;