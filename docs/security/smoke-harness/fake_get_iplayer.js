// Stand-in for get_iplayer: records exactly the argv it was given, prints nothing, exits 0.
const fs = require('fs');
fs.appendFileSync('C:/dev/smoke/argv.log', JSON.stringify(process.argv.slice(2)) + '\n');
process.exit(0);
