import { isNil, uniqBy, template, flatten, castArray } from "lodash";
import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import issueParser from "issue-parser";

const pFilter = require("p-filter");
const plugin = require("@semantic-release/github");

const ThrottlingOctokit = Octokit.plugin(throttling);

function getOctokit(token: string) {
  return new ThrottlingOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: any) => {
        console.warn(
          `RateLimit detected for request ${options.method} ${options.url}.`
        );
        console.info(`Retrying after ${retryAfter} seconds.`);
        return true;
      },
      onSecondaryRateLimit: (retryAfter: number, options: any) => {
        console.warn(
          `SecondaryRateLimit detected for request ${options.method} ${options.url}.`
        );
        console.info(`Retrying after ${retryAfter} seconds.`);
        return true;
      },
    },
  });
}

function getSearchQueries(base: string, commits: any[], separator = "+") {
  return commits.reduce((searches, commit) => {
    const lastSearch = searches[searches.length - 1];

    if (
      lastSearch &&
      lastSearch.length + commit.length <= 256 - separator.length
    ) {
      searches[searches.length - 1] = `${lastSearch}${separator}${commit}`;
    } else {
      searches.push(`${base}${separator}${commit}`);
    }

    return searches;
  }, []);
}

function parseGithubUrl(repositoryUrl: string): { owner: any; repo: any } {
  const [match, auth, host, path] =
    /^(?!.+:\/\/)(?:(?<auth>.*)@)?(?<host>.*?):(?<path>.*)$/.exec(
      repositoryUrl
    ) || [];
  try {
    const [, owner, repo] =
      /^\/(?<owner>[^/]+)?\/?(?<repo>.+?)(?:\.git)?$/.exec(
        new URL(
          match
            ? `ssh://${auth ? `${auth}@` : ""}${host}/${path}`
            : repositoryUrl
        ).pathname
      ) as any;
    return { owner, repo };
  } catch {
    return {
      owner: undefined,
      repo: undefined,
    };
  }
}

const HOME_URL = "https://github.com/semantic-release/semantic-release";
const linkify = (releaseInfo: any) =>
  `${
    releaseInfo.url
      ? `[${releaseInfo.name}](${releaseInfo.url})`
      : `\`${releaseInfo.name}\``
  }`;

function getSuccessComment(issue: any, releaseInfos: any, nextRelease: any) {
  return `:tada: This ${
    issue.pull_request ? "PR is included" : "issue has been resolved"
  } in version ${nextRelease.gitTag} :tada:${
    releaseInfos.length > 0
      ? `\n\nThe release is available on${
          releaseInfos.length === 1
            ? ` ${linkify(releaseInfos[0])}`
            : `:\n${releaseInfos
                .map((releaseInfo: any) => `- ${linkify(releaseInfo)}`)
                .join("\n")}`
        }`
      : ""
  }

Your **[semantic-release](${HOME_URL})** bot :package::rocket:`;
}

// Assumes the @semantic-release/github plugin has verified GitHub authentication
async function successPatched(pluginConfig: any, context: any) {
  const {
    options: { repositoryUrl },
    commits,
    nextRelease,
    releases,
    logger,
  } = context;

  const errors: any[] = [];

  const releasedLabels = isNil(pluginConfig.releasedLabels)
    ? [
        `released<%= nextRelease.channel ? \` on @\${nextRelease.channel}\` : "" %>`,
      ]
    : pluginConfig.releasedLabels === false
    ? false
    : castArray(pluginConfig.releasedLabels);

  const githubToken = process.env["GH_TOKEN"] || process.env["GITHUB_TOKEN"];
  if (githubToken === undefined) {
    throw new Error("Expected GITHUB_TOKEN environment variable to be defined");
  }

  const githubUrl =
    pluginConfig.githubUrl ||
    process.env["GITHUB_API_URL"] ||
    process.env["GH_URL"] ||
    process.env["GITHUB_URL"];
  if (githubUrl === undefined) {
    throw new Error("Expected GITHUB_URL environment variable to be defined");
  }

  const octokit = getOctokit(githubToken);
  // In case the repo changed name, get the new `repo`/`owner` as the search API will not follow redirects
  const [owner, repo] = (
    await octokit.rest.repos.get(parseGithubUrl(repositoryUrl))
  ).data.full_name.split("/") as [string, string];

  const parser = issueParser("github", githubUrl ? { hosts: [githubUrl] } : {});
  const releaseInfos = releases.filter((release: any) => Boolean(release.name));
  const shas = commits.map(({ hash }: any) => hash);

  const searchQueries = getSearchQueries(
    `repo:${owner}/${repo}+type:pr+is:merged`,
    shas
  ).map(
    async (q: any) =>
      (await octokit.rest.search.issuesAndPullRequests({ q })).data.items
  );

  const prs = await pFilter(
    uniqBy(flatten(await Promise.all(searchQueries)), "number"),
    async ({ number }: any) =>
      (
        await octokit.rest.pulls.listCommits({
          owner,
          repo,
          pull_number: number,
        })
      ).data.find(({ sha }) => shas.includes(sha)) ||
      shas.includes(
        (
          await octokit.rest.pulls.get({ owner, repo, pull_number: number })
        ).data.merge_commit_sha
      )
  );

  // debug(
  //   'found pull requests: %O',
  //   prs.map((pr) => pr.number)
  // );

  // Parse the release commits message and PRs body to find resolved issues/PRs via comment keyworkds
  const issues = [
    ...prs.map((pr: any) => pr.body),
    ...commits.map((commit: any) => commit.message),
  ].reduce((issues, message) => {
    return message
      ? issues.concat(
          parser(message)
            .actions["close"]!.filter(
              (action) =>
                isNil(action.slug) || action.slug === `${owner}/${repo}`
            )
            .map((action) => ({ number: Number.parseInt(action.issue, 10) }))
        )
      : issues;
  }, []);

  // debug('found issues via comments: %O', issues);

  await Promise.all(
    uniqBy([...prs, ...issues], "number").map(async (issue: any) => {
      const body = getSuccessComment(issue, releaseInfos, nextRelease);
      try {
        const comment = { owner, repo, issue_number: issue.number, body };
        // debug('create comment: %O', comment);
        const {
          data: { html_url: url },
        } = await octokit.rest.issues.createComment(comment);
        logger.log("Added comment to issue #%d: %s", issue.number, url);

        if (releasedLabels) {
          const labels = releasedLabels.map((label: any) =>
            template(label)(context)
          );
          // Don’t use .issues.addLabels for GHE < 2.16 support
          // https://github.com/semantic-release/github/issues/138
          await octokit.request(
            "POST /repos/:owner/:repo/issues/:number/labels",
            {
              owner,
              repo,
              number: issue.number,
              data: labels,
            }
          );
          logger.log("Added labels %O to issue #%d", labels, issue.number);
        }
      } catch (error: any) {
        if (error.status === 403) {
          logger.error(
            "Not allowed to add a comment to the issue #%d.",
            issue.number
          );
        } else if (error.status === 404) {
          logger.error(
            "Failed to add a comment to the issue #%d as it doesn't exist.",
            issue.number
          );
        } else {
          errors.push(error);
          logger.error(
            "Failed to add a comment to the issue #%d.",
            issue.number
          );
          // Don't throw right away and continue to update other issues
        }
      }
    })
  );
}

module.exports = {
  ...plugin,
  success: successPatched,
};
