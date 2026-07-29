# n8n-nodes-jsonschema

**JSON Schema Tools** — an n8n community node to validate, parse, and normalize JSON or JSON-like text against a target JSON Schema inside n8n workflows.

This node helps you:

- **Validate** input against a JSON Schema (type checks, required fields, additionalProperties).
- **Text to JSON** parse informal or malformed JSON-like text into structured JSON.
- **Normalize** unstructured input to a target schema (field mapping, case-insensitive matching, defaults).
## Table of contents

- [Installation](#installation)  
- [Operations](#operations)  
  - [Text to JSON (`textToJson`)](#text-to-json-texttojson)  
  - [Schema Validator (`validate`)](#schema-validator-validate)  
  - [Unstructured to Structured (`normalize`)](#unstructured-to-structured-normalize)  
- [Node parameters](#node-parameters)  
- [Examples](#examples)  
  - [Text to JSON example](#text-to-json-example)  
  - [Validate example](#validate-example)  
  - [Normalize example](#normalize-example)  
- [Behavior notes and edge cases](#behavior-notes-and-edge-cases)  
- [Compatibility](#compatibility)
- [Resources](#resources)  
## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

### Text to JSON (`textToJson`)
Parses text that looks like JSON into a structured JSON object. The parser supports:

- Strict JSON (`{...}` or `[...]`) via `JSON.parse`.
- Single-quoted keys/values by normalizing quotes.
- Informal comma-separated object-like syntax: `{ key: value, key2: value2 }` (missing values become `null`).
- Multi-line `key: value` lines.
- Falls back to returning the raw string if parsing fails.

**Output**:

```json
{ "success": true, "parsed": <object> }
```
or for empty input:
```json
{ "success": false, "parsed": null }
```
### Schema Validator (`validate`)

Validates input data against a provided JSON Schema. This node includes a **minimal** in-node validator that checks:

- Top-level `type` (object, array, string, number, boolean).  
- `required` properties.  
- Property-level `type` in `properties`.  
- `additionalProperties: false` when `strict` is enabled.

**Parameters**

- `schema` (JSON): The JSON Schema to validate against.  
- `strict` (boolean, default `true`): When `true`, and `schema.additionalProperties === false`, extra properties cause validation errors.

**Behavior**

- If `schema` is empty or cannot be parsed, the validator treats it as "no constraints" and returns `valid: true`.  
- Property type checks only run when the property exists in the input and the schema declares a `type` for that property.  
- `required` checks report a `required` error for each missing required property.  
- When `strict` is `true` and `schema.additionalProperties === false`, any input property not listed in `schema.properties` produces an `additionalProperties` error.

**Output**

```json
{
  "valid": true|false,
  "errors": [
    { "keyword": "type"|"required"|"additionalProperties", "message": "..." }
  ] | null
}
```
### Unstructured to Structured (`normalize`)

Maps input data to the structure defined by a JSON Schema. Designed to convert loose or unstructured input into a predictable object shape.

**Features**

- Accepts input as text or object (parses text using the same parser as `textToJson`).  
- Case-insensitive matching of keys.  
- Optional `autoMap` to match keys by normalized form (strip `_`, `-`, spaces and compare lowercase).  
- Applies `default` values from `schema.properties` when a property is missing (enabled by default in the shipped code).  
- If normalization produces an object deeply equal to the input, the original input is returned to avoid unnecessary changes.  
- If `schema.type === "array"` and `schema.items` is present, the normalized object is wrapped in an array.

**Parameters**

- `schema` (JSON): The target schema with `properties`.  
- `autoMap` (boolean, default `true`): Enable fuzzy key matching.

**Mapping algorithm (summary)**

1. Parse `data` if it is a string.  
2. For each `targetKey` in `schema.properties`:
   - If `data` has `targetKey` exactly, use it.
   - Else if a case-insensitive match exists, use that value.
   - Else if `autoMap` is enabled and a normalized-key match exists, use that value.
   - Else if the schema property defines `default`, assign the default.
   - Else assign `null` (or omit if you change behavior to skip missing keys).
3. If `schema.type === "array"` and `schema.items` exists, return `[out]`.  
4. If `out` is deeply equal to `data`, return `data`; otherwise return `out`.

**Output**

```json
{
  "normalized": { /* mapped object */ }
}
```

## Node parameters

| Parameter | Type | Required | Description |
|---|---:|:---:|---|
| **operation** | `options` | yes | `validate`, `textToJson`, or `normalize`. |
| **input** | `string` | yes | Input text or JSON string. The node attempts to parse this value. |
| **schema** | `json` | conditional | JSON Schema used for `validate` and `normalize`. Accepts object or JSON string. |
| **autoMap** | `boolean` | conditional | For `normalize`: enable fuzzy mapping (default `true`). |
| **strict** | `boolean` | conditional | For `validate`: enforce `additionalProperties: false` when set (default `true`). |

> The node accepts `schema` either as a JSON object (preferred) or as a JSON string (for example, from a Set node). The node will attempt to parse string schemas automatically.
## Examples

### Text to JSON example

**Input (Set node)**:
```json
{ name: Adam Smith, age: }
```

**JSON Schema Tools**  
- Operation: `Text to JSON`

**Output**:

```json
{
  "success": true,
  "parsed": {
    "name": "Adam Smith",
    "age": null
  }
}
```

### Validate example

**Input (Set node)**:

```text
input = "{}"
schema = "{\"type\":\"object\",\"required\":[\"name\"],\"properties\":{\"name\":{\"type\":\"string\"}}}"
```
### JSON Schema Tools
- Operation: `validate`
- Strict: `true`

**Output**:
```json
{
  "valid": false,
  "errors": [
    { "keyword": "required", "message": "Missing required property: name" }
  ]
}
```
### Normalize example

**Input (Set node)**:

```text
input = "{\"first_name\":\"Adam\"}"
schema = "{\"properties\":{\"firstName\":{}}}"
autoMap = true
```
### JSON Schema Tools
- Operation: `normalize`
- Auto Map: `true`

**Output**:
```json
{
  "normalized": {
    "firstName": "Adam"
  }
}
```
** Default values **
If schema contains defaults: 
```text
schema = "{\"properties\":{\"role\":{\"default\":\"user\"}}}"
input = "{}"
```
**Output (default behavior)**:
```json
{
  "normalized": {
    "role": "user"
  }
}
```
The node applies default values by design. If you prefer defaults to be opt-in, see the "Behavior notes" section for how to change that.


## Behavior notes and edge cases

- **Schema parsing**: If `schema` is provided as a string (e.g., from a Set node), the node attempts `JSON.parse`. If parsing fails, the node treats the schema as empty (which causes `validate` to return `valid: true` by design because an empty schema means "no constraints").
- **Empty schema**: The validator returns `{ ok: true }` when the schema is empty. This is intentional: an empty schema imposes no constraints.
- **Defaults**: Normalization applies `default` values from `schema.properties` when a property is missing. If you want defaults to be optional, modify the code to add an `applyDefaults` parameter or skip default assignment.
- **Input enforcement**: The shipped code enforces a non-empty `input` parameter at runtime. If you want the node to fall back to `items[i].json` when `input` is empty, adjust the runtime input handling accordingly.
- **Minimal validator**: The built-in validator is intentionally minimal and does not implement the full JSON Schema specification. For full compliance, use a code node and integrate a library such as `ajv`.
- **Normalization equality**: If the normalized object is deeply equal to the input, the node returns the original input (to avoid unnecessary changes).

## Compatibility

- **Minimum n8n version**: test with n8n versions that support community nodes and the `n8n-workflow` interfaces used by this node. Confirm against your environment; the node uses standard n8n node interfaces.
- Tested with n8n community node runner and n8n test images that support hot reload for custom nodes **version 2.32.6**.
## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
