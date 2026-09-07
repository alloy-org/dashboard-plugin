# Subscription-specific Entity functionality

Occasionally, we will need to make an Entity's functionality, limits or features specific to its subscription type: Pro
users may have a certain PR processing limit, for example, that's lower than Elite users' limit. One important note when
setting up such differences is that it can be very tempting to set this at a Subscription level, like so:

```ruby
class Subscription < ActiveRecord
  def pr_processing_limit
    elite? ? 5000 : 1000
  end
end
```

This may seem intuitive, but it's not advisable, since Enterprise instances lack any notion of a "subscription" (it's
based on licenses, which have a minimal set of properties and are always one-per-instance). Reliance on the existence of
a subscription for a thing like PR processing logic has caused bugs that often only get discovered when some key
feature is broken on a customer's instance.

Tests can spot this, but it's hard to always remember to test something like that on Enterprise as well as SaaS.

Instead, this should be done as part of `Entity`, possibly delegating to `Subscription` in SaaS specifically, e.g.

```ruby
class Entity < ActiveRecord
  def pr_processing_limit
    Enterprise.active_environment? ? 10000 : subscription.pr_processing_limit
  end
end
```

This lets us set Subscription-specific logic when warranted, without relying on the existence of such records.
