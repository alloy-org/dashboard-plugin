# Best practices: Naming files in Ruby, JavaScript and React

Here are the general guidelines to naming files and modules, as of February 2021.

## Ruby: snake_case, with modules in CamelCase

e.g. `files_controller.rb` containing `FilesController`. This naming scheme matches how Rails auto-loads
constants, so it's important to use whenever possible.

## React: kebab-case, with modules in CamelCase

Our React code (stored in `app/javascript`), our 100% more modern way of writing new JS, prefers
the use of kebab case for filesnames, with the same CamelCasing for modules.

e.g. `line-impact-editor.js` would contain the `LineImpactEditor` component.

## React packs: snake_case

The one exception to our React standard is packs, which use a more Ruby-like snake_case pattern, as they
get loaded from Rails views.

e.g. `line_impact_editor.jsx` is a pack that sets up loading the `LineImpactEditor` component.

## Legacy JS: snake_case for root-level controller JS, with _snake_case for individual actions

The aforementioned JS naming system does *not* apply to javascript in our legacy `app/assets/javascripts`,
which uses a slightly different scheme: JavaScript files are named according to the controller, like `users.js`
for stuff used within `UsersController`. We then use that file to load in stuff within the `users/` subdirectory,
where the files in there are designed to match the action(s) each file's code is used within. So `users/_index.js`
for `UsersController#index`, etc.

You can see much prior art about how these are instantiated and used in our existing JS, but be wary of making
new things with this, as it's a lot harder to use and debug than React.
