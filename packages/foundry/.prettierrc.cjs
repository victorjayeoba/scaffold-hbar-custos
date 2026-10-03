// Prettier 2 loads every prettier-plugin-* it finds in the node_modules that holds it. npm hoists this package's
// prettier 2 to the root next to the app's @trivago/prettier-plugin-sort-imports, which then reorders these scripts'
// imports and fails `prettier --check`; Yarn keeps them apart. Turning plugin search off makes both installs agree.
module.exports = {
  pluginSearchDirs: false,
};
