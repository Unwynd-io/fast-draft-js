const fs = require('fs');
// ! run "node scripts/update-package-version.js" from the root with other bundled commands.

// DIRECT PATH TO THE PACKAGE.JSON FILE
const ABSOLUTE_PATH = __dirname.replace('scripts', 'package.json');
const draftPackageJson = fs.readFileSync(ABSOLUTE_PATH);
if(!draftPackageJson) {
  console.warn('No package.json file found, skipping updating version');
  return;
}

const packageJson = JSON.parse(draftPackageJson);
const version = packageJson.version;

let newFile = {
  ...packageJson,
}

// ! FORMAT: 0.17-SC-1
const splitVer = version.split('-')
const numbering = splitVer[splitVer.length-1];
if(parseInt(numbering)) {
  const newNumbering = parseInt(numbering) + 1;
  newFile = {
    ...newFile,
    version: `${splitVer[0]}-${newNumbering}`
  }
} else {
  console.info('No versioning counter found, adding one now.')
  newFile = {
    ...newFile,
    version: '0.11.7-SC-1'
  }
}

// write the new package.json file
fs.writeFileSync(ABSOLUTE_PATH, JSON.stringify(newFile, null, 2));
console.log('UPDATED DRAFT "package.json" FILE TO NEW VERSION: ', newFile.version);

process.exit(0);