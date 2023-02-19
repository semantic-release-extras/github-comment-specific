# @semantic-release-extras/github-comment-specific

This is a drop-in replacement for the standard [@semantic-release/github] plugin.
It exists to add specificity to the GitHub issue and PR comments, so instead
of commenting that

> This PR is included in version {version}

it comments

> This PR is included in version {package}@{version}

[@semantic-release/github]: https://github.com/semantic-release/github

## Why?

I agree, this seems like a small improvement. However, when using semantic-release with a multirepo[^1] the default behavior adds several comments like this to a PR:

<img src="https://user-images.githubusercontent.com/1596818/212568167-24b6b93d-c773-4ba8-8b62-e1da383231e4.png" width="50%" height="50%">

which is downright confusing.

With **@semantic-release-extras/github-comment-specific**, the comments look like:

<img src="https://user-images.githubusercontent.com/1596818/212568163-273a256a-1836-4d97-9a7e-621c9df5b723.png" width="50%" height="50%">

Much better!

## Install

```shell
npm install --save-dev --save-exact @semantic-release-extras/github-comment-specific
```

## Use

**@semantic-release-extras/github-comment-specific** is just a wrapper, so it inherits the API contract of [@semantic-release/github].
Follow its docs:

| Step               | Description                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifyConditions` | Verify the presence and the validity of the authentication (set via environment variables) and the assets option configuration.                                                                                                          |
| `publish`          | Publish a [GitHub release](https://help.github.com/articles/about-releases), optionally uploading file assets.                                                                                                                           |
| `addChannel`       | Update a [GitHub release](https://help.github.com/articles/about-releases)'s `pre-release` field.                                                                                                                                        |
| `success`          | Add a comment to each [GitHub Issue](https://help.github.com/articles/about-issues) or [Pull Request](https://help.github.com/articles/about-pull-requests) resolved by the release and close issues previously open by the `fail` step. |
| `fail`             | Open or update a [GitHub Issue](https://help.github.com/articles/about-issues) with information about the errors that caused the release to fail.                                                                                        |

For example:

```json
{
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/git",
    "@semantic-release-extras/github-comment-specific"
  ]
}
```

## Alternatives

### Template string

It may be possible to use the stock @semantic-release/github plugin with configuration like:

```json
[
  "@semantic-release/github",
  {
    "successComment": ":tada: This ${issue.pull_request ? 'PR is included' : 'issue has been resolved'} in version ${nextRelease.gitTag}</br></br>The release is available on [${releases[0].name}](${releases[0].url}) :tada:</br></br>Your **[semantic-release](https://github.com/semantic-release/semantic-release)** bot :package::rocket:"
  }
]
```

> **Note**: This configuration is untested.

However, the templating options offered by the stock plugin leave something to be desired.
This template is not one-to-one with **@semantic-release-extras/github-comment-specific** in terms of features or flexibility.

### Upstream the changes

Wouldn't it be better to upstream these changes?

Yep, definitely.
The upstream repository has a high load:maintainers ratio at the moment, and this plugin exists here and now.

[^1]: https://github.com/dhoulb/multi-semantic-release
