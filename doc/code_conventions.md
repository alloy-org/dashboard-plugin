# Code Conventions

When writing code in the dashboard-plugin project, it is ESSENTIAL that added and updated code matches 
the following expectations. 

## Javascript conventions & best practices

### Always alphabetize arguments, always alphabetize imports, always alphabetize functions in a file

1. When passing arguments to a function or component, always list them in alphabetical order.
2. When writing new functions, insert them in alphabetical order within their section of the file
3. When writing new imports, order them alphabetically by the file path being imported

### Utilize up to 110 characters of width per line, do NOT break arguments onto multiple lines

To preserve readability, we strive to keep all Javascript files 300 lines or less, and all JS functions 50 lines or 
less. A big part of ensuring this goal is to avoid breaking function arguments onto multiple lines.

```javascript
// Bad
function exampleFunction(
  arg1,
  arg2,
  arg3
) {
  // function body
}

// Good:
function exampleFunction(arg1, arg2, arg3) {
  // function body
}

// Bad - note that the hanging second line ("providerEm") matches indent level of body:
export default function DreamTaskWidget({ app, gridHeightSize, gridWidthSize, onOpenSettings, providerApiKey,
  providerEm }) {
  // component body
}

// Good (note that the hanging second line is indented two spaces FURTHER than the body of the component/function):
export default function DreamTaskWidget({ app, gridHeightSize, gridWidthSize, onOpenSettings, providerApiKey,
    providerEm }) {
  // component body
}

// Bad
import {
  applyDreamTaskAnalysisResult,
  buildDreamTaskHeaderActions,
  fetchDreamTaskSuggestions,
} from "dream-task-internals";

// Good (non-render orchestration lives in dream-task-internals; render stays in dream-task.js)
import { applyDreamTaskAnalysisResult, fetchDreamTaskSuggestions, handleOpenSettings, handleTaskClick,
  requestDreamTaskRefreshExcludingRecent, shouldFetchMoreTasksAfterGridGrowth, _loadSeenUuidsMap,
  _maxTasksFromGrid, _recordSeenUuids, _todayProposedTasksNoteName,
} from "dream-task-internals";

// Bad
const {
  app,
  dateHeading,
  dayName,
  isWeekend,
  candidateTasks,
} = params;

// Good 
const { app, candidateTasks, dateHeading, dayName, isWeekend } = params;
```

### Spaces around interpolation

```javascript 
// Bad 
const message = `Hello, ${name}, welcome to the dashboard!`;

// Good
const message = `Hello, ${ name }, welcome to the dashboard!`;
```

### Guidelines for introducing a function or component

1. The first line for a function should be a divider to clearly distinguish the function from the previous code, 
   e.g., `// ----------------------------------------------------------------------------------------------`
2. The second line should be a comment describing the function's purpose using JSDoc, 
   e.g., `// @desc This function takes in a user object and returns a greeting message.`
3. If any of the function arguments are not of an obvious type, include a `// @param {type} argName - description` comment 
   for each such argument. 
   e.g., `// @param {Array<String>} userRoles - An array of strings representing the user's roles, e.g., ["admin", "editor"]`
4. After the divider and JSDoc, then we can include the model-based documentation discussed in AGENTS.md

### Don't use "to" in function or variable names, use "from" instead

```javascript
// Bad
function providerNameToApiKey(providerName) { ... }

// Good 
function apiKeyFromProviderName(providerName) { ... }
```
