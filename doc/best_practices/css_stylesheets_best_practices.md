# Best practices: stylesheets and CSS

As of 2024, these are the best practices recommended for writing CSS in GitClear.

## First principle: LESS IS MORE 

Let's not set a `font-size: 0.98rem` when the default is 1rem. Let's not set `color: inherit` when the default is to inherit.
Let's not set `display: block` on a div. 

General CSS rule of thumb: If your style declaration is longer than 5 lines, it should be an orange flag that you 
are writing code that will be challenging to maintain. 

## Sufficient specificity of class names (selectors)

Avoid one-word class names. They are too likely to produce ambiguous results if a maintainer later wants to 
symbol-search for a class whose style definition they wish to change. 

```scss
// Bad
.avatar { border-radius: 50%; }
// Good 
.committer_avatar {
  border-radius: 50%;
}

// Bad
.feature { margin: 10px; }
// Good
.feature_list_container {
  margin: 10px;
}
```

The ideal class name is 2-3 words long, and unique among the project's stylesheets. It isn't essential for the 
class to be unique, but using a 2-3 word name where each word is 5+ characters makes it reasonably likely it will be.

## Component hierarchical naming

When creating a hierarchy of elements, the recommended naming convention utilizes shared words to indicate lineage,
e.g., 

```haml
.all_committers_container
  .committer_container
    .committer_avatar
       .avatar_image= image_tag "avatar.jpg"
       .avatar_text_label
          .text_label_bold Avatar
    .committer_details_container      
       .details_name
         .name_text William
       .details_link_to_profile
``` 

Notice that, where possible, the child HTML nodes drop the first word from the parent, and then add extra descriptive 
words to the end of the rule.

## Four or less levels of nesting 

Don't nest more than four levels deep, it makes it too annoying to override your styles by e.g., mobile considerations.

## AVOID SPECIFICITY: Especially, any specific width and height values

Specific `width`, `height`, and `line-height` are root of many (most?) styles that are eventually discovered to look 
broken on some rarely-tested device.

Instead of using fixed width values, consider alternatives like:
1. Allow the content to dictate the size of the container
2. Size proportions of a page using small (1-3) `flex` values

3. Re: the second suggestion: you can nest elements within a `display: flex` div, and use `flex: X` (where "X" is
1-3...using larger values of the flex-grow property is a different flavor of the still-bad over-specific width) to
auto-grow elements to their desired proportions.

For example,
```html
<div class="flex_element">
  <div style="flex: 3">This gets 3/5s of the space in the container
  <div style="flex: 2">This gets 2/5s of the space in the container
</div>
```

The only "normal" situation where specific widths should be necessary is when setting the maximum size of images.

Avoid also using flex numbers >= 4, as it makes it difficult to predict the relative spacing of a table
when it mixes many large and small flex numbers.

## Other common problems to avoid

1. Avoid styling elements by tag name, e.g., `div`, `span`, `a`, etc. Instead, use a class name to style the element.
2. Avoid writing CSS rules that reset a class to defaults, e.g., `display: block` on a div, `color: inherit`, etc.
3. Avoid using `!important` in your stylesheets
4. Avoid multi-line comments. Styles should be self-documenting. If a comment is necessary, it should be a single line.
5. Avoid media selectors for breakpoints "below" a certain width. Instead, use `@include breakpoint(device)` to indicate the min device size for the styles

## SCSS magic highly discouraged 

Whenever an `@extend`, `@include`, function, can be realized through combining vanilla CSS, it should be. SASS/SCSS magic is 
hard to debug and painful to adapt.

Sometimes it is ok to implement a `@mixin` if one is implementing an especially repetitive (5+ repetitive instances) 
definition of something like mapping diff colors to class names.

## Use .is_* class naming to indicate temporary state

`.is_active` would be the standard/expected class to apply to an element we want to deem as "active." 

## Specify z-values in _z_indexes.scss

This will allow us to have a location that allows us to globally track what are the lowest-to-highest precedence 
popups being shown. 

## Prefer px

Most existing styles are sized with px, so unless the implementation is meaningfully simpler with some other unit, use px.

## Styling a class with a default rule is a code smell

If you find yourself applying CSS rules that reset a class to defaults, find a better way to structure your HTML.
Some examples of resetting to defaults:

```scss
span.naughty_class {
  color: $color-text-high-contrast;
  display: inline;
  font-weight: normal;
  font-size: $font-size-default;
  list-style-type: none;
}

div.naughty_div {
  display: block;
  margin: 0;
  padding: 0;
}
```

The right fix for this is very contextual, but usually involves not having a parent rules be applied to children.

## Namespace partials and other Rails views with a class that corresponds to stylesheet name when possible

Whenever possible, a Rails partial should be wrapped in a multi-word (to reduce ambiguity) class that ties together
the partial and stylesheet name. Examples:

* `views/commits/_code_file_shell.html.haml` is wrapped in `.code_file_shell` and has a stylesheet at
  `stylesheets/commits/_code_file_shell.scss`.
* `pages/home/_code_review.html.haml` is wrapped in a `.home_code_review` class, and has a corresponding
  `pages/home/_code_review.scss` stylesheet.
* `views/proto_mailer/quality_report.html.haml` is wrapped by `.quality_report_container` and has a corresponding
  `stylesheets/emails/proto_mailer/_quality_report.scss` stylesheet.

Wrapping the partial in a class that corresponds to the partial's name (often `.partial_name_container`) ensures that
the styles authored for the partial (even the generally-avoidable generic element rules) will not leak out to
impact other parts of the page, or other pages that happen to include the stylesheet for the partial, since many
of our stylesheets include entire directories of partial stylesheets.

Wrapping the partial in a class name is generally preferable to wrapping it in an ID, since it is difficult-to-
impossible to override an element that is defined within an id rule.
