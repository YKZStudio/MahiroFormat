"use strict";

// Build-time selection only: never mutate an installed application or a shared
// engine tree. Unknown files/themes remain included until separately validated.
const { FileMatcher } = require("app-builder-lib/out/fileMatcher");

const LIBREOFFICE_DISTRIBUTION_FILTER = [
  "**/*",
  "!**/share/extensions/dict-*/th_*.dat",
  "!**/share/extensions/dict-*/th_*.idx",
  "!**/share/config/images_{breeze,breeze_dark,breeze_svg,breeze_dark_svg,elementary,elementary_svg,karasa_jaga,karasa_jaga_svg,sifr,sifr_dark,sifr_svg,sifr_dark_svg,sukapura,sukapura_dark,sukapura_svg,sukapura_dark_svg}.zip"
];

const APP_DISTRIBUTION_EXCLUSIONS = [
  "!node_modules/**/*.{js,mjs,cjs,css,ts,min}.map",
  "!node_modules/@tesseract.js-data/{eng,chi_sim,tha}/**/*.traineddata.gz"
];

function createLibreOfficeFilter(root) {
  return new FileMatcher(root, root, value => value, LIBREOFFICE_DISTRIBUTION_FILTER).createFilter();
}

function createApplicationFilter(root) {
  return new FileMatcher(root, root, value => value, ["**/*", ...APP_DISTRIBUTION_EXCLUSIONS]).createFilter();
}

module.exports = { LIBREOFFICE_DISTRIBUTION_FILTER, APP_DISTRIBUTION_EXCLUSIONS, createLibreOfficeFilter, createApplicationFilter };
