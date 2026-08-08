export const defaultTemplate = `# {{title}}
{{#description}}
{{description}}
{{/description}}
{{^hasSymbols}}
_No documented symbols found._
{{/hasSymbols}}
{{#symbols}}
## {{name}}

**{{kind}}** · lines {{location.startLine}}–{{location.endLine}}
{{#sourcePath}}
Source: \`{{{sourcePath}}}\`
{{/sourcePath}}

\`\`\`{{language}}
{{{signature}}}
\`\`\`
{{#description}}

{{description}}
{{/description}}
{{#parameters.length}}

### Parameters
{{#parameters}}

- \`{{{.}}}\`
{{/parameters}}
{{/parameters.length}}
{{#members.length}}

### Members
{{#members}}

#### {{name}}

\`\`\`{{language}}
{{{signature}}}
\`\`\`
{{#description}}

{{description}}
{{/description}}
{{#parameters.length}}

##### Parameters
{{#parameters}}

- \`{{{.}}}\`
{{/parameters}}
{{/parameters.length}}
{{/members}}
{{/members.length}}
{{/symbols}}
`;

export const classTemplate = `---
title: {{{frontmatterTitleYaml}}}
description: {{{packageDescriptionYaml}}}
---

# {{title}} {{symbolTypeLabel}}
{{#symbols}}
{{#description}}

{{description}}
{{/description}}
{{#parameterDetails.length}}

## Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
{{#parameterDetails}}
| \`{{name}}\` | \`{{type}}\` | {{description}} |
{{/parameterDetails}}
{{/parameterDetails.length}}
{{#members.length}}

## Methods

{{#members}}- [{{name}}](#{{anchor}})
{{/members}}
{{#members}}

### \`{{name}}\`

{{#description}}{{description}}{{/description}}{{^description}}UNDOCUMENTED{{/description}}
{{#parameterDetails.length}}

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
{{#parameterDetails}}
| \`{{name}}\` | \`{{type}}\` | {{description}} |
{{/parameterDetails}}
{{/parameterDetails.length}}
{{/members}}
{{/members.length}}
{{/symbols}}
`;

export const functionsTemplate = `---
title: {{{frontmatterTitleYaml}}}
description: {{{packageDescriptionYaml}}}
---

# Functions
{{#functions}}

## \`{{name}}\`

{{#description}}{{description}}{{/description}}{{^description}}undocumented{{/description}}
{{#parameterDetails.length}}

### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
{{#parameterDetails}}
| \`{{name}}\` | {{type}} | {{description}} |
{{/parameterDetails}}
{{/parameterDetails.length}}
{{/functions}}
`;

export const declarationTemplate = `---
title: {{{frontmatterTitleYaml}}}
description: {{{packageDescriptionYaml}}}
---

# {{title}} {{symbolTypeLabel}}
{{#symbols}}

{{#description}}{{description}}{{/description}}{{^description}}UNDOCUMENTED{{/description}}

\`\`\`{{language}}
{{{signature}}}
\`\`\`
{{/symbols}}
`;

export const classesTemplate = `---
title: {{{frontmatterTitleYaml}}}
description: {{{packageDescriptionYaml}}}
---

# Classes

{{#classLinks}}- [{{name}}]({{{href}}})
{{/classLinks}}{{^classLinks}}_No classes found._
{{/classLinks}}
`;

export const indexTemplate = `---
title: {{{frontmatterTitleYaml}}}
description: {{{packageDescriptionYaml}}}
---

# {{title}}

{{#indexLinks}}- [{{name}}]({{{href}}})
{{/indexLinks}}{{^indexLinks}}_No {{titleLower}} found._
{{/indexLinks}}
`;

export const agentSymbolTemplate = `---
name: {{{nameYaml}}}
qualifiedName: {{{qualifiedNameYaml}}}
kind: {{{kindYaml}}}
language: {{{languageYaml}}}
module: {{{moduleYaml}}}
source: {{{sourcePathYaml}}}
visibility: "public"
---

# {{name}} {{symbolTypeLabel}}

{{#description}}{{description}}{{/description}}{{^description}}UNDOCUMENTED{{/description}}

## Signature

\`\`\`{{language}}
{{{signature}}}
\`\`\`
{{#parameterDetails.length}}

## Parameters
{{#parameterDetails}}

- name: \`{{name}}\`
  type: \`{{type}}\`
  required: true
  description: {{#description}}{{description}}{{/description}}{{^description}}UNDOCUMENTED{{/description}}
{{/parameterDetails}}
{{/parameterDetails.length}}
{{#returns}}

## Returns

- type: \`{{returns}}\`
{{/returns}}
{{#members.length}}

## Members
{{#members}}

### {{name}}

\`\`\`{{language}}
{{{signature}}}
\`\`\`

{{#description}}{{description}}{{/description}}{{^description}}UNDOCUMENTED{{/description}}
{{#parameterDetails.length}}

Parameters:
{{#parameterDetails}}

- \`{{name}}\` (\`{{type}}\`): {{#description}}{{description}}{{/description}}{{^description}}UNDOCUMENTED{{/description}}
{{/parameterDetails}}
{{/parameterDetails.length}}
{{/members}}
{{/members.length}}
`;
