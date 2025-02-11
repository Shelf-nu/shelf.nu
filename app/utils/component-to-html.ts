import { renderToStaticMarkup } from "react-dom/server";

/**
 * This function generates the html node from a react component with font family
 */
export function generateHtmlFromComponent(component: React.ReactElement) {
  const componentMarkup = renderToStaticMarkup(component);

  const htmlElement = document.createElement("html");
  htmlElement.innerHTML = `
<body>
<style>
* {
 box-sizing: border-box;
}

body {
font-family: Inter, sans-serif;
}
</style>
${componentMarkup}
</body>
`;

  return htmlElement;
}
