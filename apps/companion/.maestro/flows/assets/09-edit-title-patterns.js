// Helper for 09-edit-save-refresh.yaml (runScript, Maestro's JS engine).
//
// Maestro text selectors are full-match regexes, and asset titles carry
// regex characters such as "(ID123)". This turns output.originalTitle into
// two exact patterns: the title as loaded (output.originalTitlePattern) and
// with the flow's marker appended (output.savedTitlePattern).
var specials = "\\^$.|?*+()[]{}";

function escapeForRegex(text) {
  var escaped = "";
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    escaped += specials.indexOf(ch) >= 0 ? "\\" + ch : ch;
  }
  return escaped;
}

output.originalTitlePattern = escapeForRegex(output.originalTitle);
output.savedTitlePattern = escapeForRegex(output.originalTitle + " e2e");
