export function replacePlaceholders(template, variables) {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const replacement = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
    result = result.replaceAll(placeholder, replacement);
  }

  return result;
}
