# Best practices on how and when to create Rails Concerns

A Rails concern is a module that includes `extend ActiveSupport::Concern` at the beginning of the module, which 
enables the model to take on qualities as if it were in the body of a Rails model. ActiveRecord concerns are the 
tool Ruby/Rails offers to prevent individual code files from becoming impenetrable monoliths of methods. 

## When to create a new concern

Bill has come to believe (todo: look up or create research) that 300 lines per file is a good target for maximum 
length. That generally allows around 10-20 methods to exist within the file, which implies a fairly narrow range 
of concerns for the file. 

If a file is longer than 300 lines, evaluate whether its methods form any sort of nameable group that could exclusively 
be used to describe those methods. Keeping a narrow range of concerns in the file is one of our best tools to avoid 
unknowningly duplicating our past efforts. 

As a demo, let's consider the first few concerns within commit.rb as of 2022:

```ruby
include CommitConcerns::CommitDuplicationConcerns # Good: there are probably only a few methods that pertain to evaluating and responding to duplicate content, and those methods are likely to be dense, so great to keep them out of commit.rb
include CommitConcerns::CommitImpactConcerns # Ok: Since impact is so tied in to every facet of commit, there are sure to be impact-related methods that will be present in the main model. But at least this bucket surely captures a lot of methods.
include CommitConcerns::CommitMinuteConcerns # Good: there are hundreds of lines worth of logic that evaluate how long a commit took. These methods should be mutually exclusive (not overlap) other commit functionality
include CommitConcerns::CommitPresenceConcerns # Kind of bad: Difficult to guess what it would implement, aside from the enum for presence_em
include CommitConcerns::CommitProviderMethods # Good: A method like this could be expected to call to external APIs that interface with commits
```

## Avoiding pitfalls

Of course concerns come with concerns.

### Don't place callbacks in concerns

Since a concern can contain associations or any other Rails functionality, it's possible to create a concern with 
something like 

```ruby
module BadIdea
  extend ActiveSupport::Concern

  included do 
    after_commit :do_something_youll_never_guess
  end
end
```

As the example implies, the problem is that callbacks are the source of some of the most vexing debug scenarios devs 
find themselves in. The first challenge is simply to determine the full set of callbacks that will run with then model 
is being saved. When you embed callbacks in concerns, that implies that the developer will need to visit potentially 
10 files, where a small fraction might hold a vital callback that describes the anomalous behavior observed. 

So please place all lifecycle callbacks in the model itself.
