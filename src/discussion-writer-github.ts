import 'dotenv/config';
import { Octokit } from '@octokit/rest';
import type {
  ActivityCommit,
  ActivityIssue,
  ActivityPullRequest,
  ActivityRelease,
  CreatedDiscussion,
  DiscussionCategory,
  RecentDiscussion,
} from './discussion-writer.js';

const token = process.env.GITHUB_TOKEN;
if (!token) {
  throw new Error('GITHUB_TOKEN is required for discussion writer GitHub operations.');
}

const owner = process.env.GITHUB_OWNER || 'RocketDelivery2';
const repo = process.env.GITHUB_REPO || 'github-copilot-jackhammer-service';
const octokit = new Octokit({ auth: token });

export type RepositoryRelease = ActivityRelease;
export type RepositoryPullRequestActivity = ActivityPullRequest;
export type RepositoryIssueActivity = ActivityIssue;
export type RepositoryCommitActivity = ActivityCommit;

export async function resolveRepositoryNodeId(): Promise<string> {
  const response = await octokit.graphql<{ repository: { id: string } }>(
    `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        id
      }
    }`,
    { owner, repo },
  );

  return response.repository.id;
}

export async function resolveDiscussionCategoryBySlugOrName(slugOrName: string): Promise<DiscussionCategory | null> {
  const response = await octokit.graphql<{
    repository: {
      discussionCategories: {
        nodes: Array<{ id: string; slug: string; name: string }>;
      };
    };
  }>(
    `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        discussionCategories(first: 50) {
          nodes {
            id
            slug
            name
          }
        }
      }
    }`,
    { owner, repo },
  );

  const normalized = slugOrName.trim().toLowerCase();
  const match = response.repository.discussionCategories.nodes.find(category => (
    category.slug.toLowerCase() === normalized || category.name.toLowerCase() === normalized
  ));

  return match ? { id: match.id, slug: match.slug, name: match.name } : null;
}

export async function readRecentDiscussions(limit = 20): Promise<RecentDiscussion[]> {
  const response = await octokit.graphql<{
    repository: {
      discussions: {
        nodes: Array<{
          id: string;
          number: number;
          title: string;
          body: string;
          url: string;
          createdAt: string;
        }>;
      };
    };
  }>(
    `query($owner: String!, $repo: String!, $limit: Int!) {
      repository(owner: $owner, name: $repo) {
        discussions(first: $limit, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            id
            number
            title
            body
            url
            createdAt
          }
        }
      }
    }`,
    { owner, repo, limit },
  );

  return response.repository.discussions.nodes.map(discussion => ({
    id: discussion.id,
    title: discussion.title,
    body: discussion.body ?? '',
    url: discussion.url,
    createdAt: discussion.createdAt,
  }));
}

export async function createRepositoryDiscussion(input: {
  categoryId: string;
  title: string;
  body: string;
}): Promise<CreatedDiscussion> {
  const repositoryId = await resolveRepositoryNodeId();
  const response = await octokit.graphql<{
    createDiscussion: {
      discussion: {
        id: string;
        number: number;
        title: string;
        url: string;
      };
    };
  }>(
    `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
      createDiscussion(input: {
        repositoryId: $repositoryId,
        categoryId: $categoryId,
        title: $title,
        body: $body
      }) {
        discussion {
          id
          number
          title
          url
        }
      }
    }`,
    {
      repositoryId,
      categoryId: input.categoryId,
      title: input.title,
      body: input.body,
    },
  );

  return {
    id: response.createDiscussion.discussion.id,
    number: response.createDiscussion.discussion.number,
    title: response.createDiscussion.discussion.title,
    url: response.createDiscussion.discussion.url,
  };
}

function toIsoDaysAgo(windowDays: number): string {
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
}

export async function getLatestPublishedRelease(windowDays: number): Promise<RepositoryRelease | null> {
  const since = toIsoDaysAgo(windowDays);
  const response = await octokit.repos.listReleases({ owner, repo, per_page: 10 });
  const release = response.data
    .filter(entry => !entry.draft && !!entry.published_at && entry.published_at >= since)
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))[0];

  if (!release) return null;

  return {
    id: String(release.id),
    tagName: release.tag_name,
    name: release.name ?? release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at ?? '',
    body: release.body ?? '',
  };
}

export async function listMergedPullRequests(windowDays: number): Promise<RepositoryPullRequestActivity[]> {
  const since = toIsoDaysAgo(windowDays);
  const response = await octokit.pulls.list({
    owner,
    repo,
    state: 'closed',
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
  });

  return response.data
    .filter(pr => !!pr.merged_at && pr.merged_at >= since)
    .map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      mergedAt: pr.merged_at ?? '',
    }));
}

export async function listClosedIssues(windowDays: number): Promise<RepositoryIssueActivity[]> {
  const since = toIsoDaysAgo(windowDays);
  const response = await octokit.issues.listForRepo({
    owner,
    repo,
    state: 'closed',
    since,
    per_page: 100,
  });

  return response.data
    .filter(issue => !issue.pull_request && !!issue.closed_at)
    .map(issue => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      closedAt: issue.closed_at ?? '',
    }));
}

export async function listRoadmapIssues(windowDays: number): Promise<RepositoryIssueActivity[]> {
  const since = toIsoDaysAgo(windowDays);
  const response = await octokit.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    labels: 'roadmap',
    since,
    per_page: 100,
  });

  return response.data
    .filter(issue => !issue.pull_request)
    .map(issue => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      closedAt: issue.updated_at,
    }));
}

export async function listRecentCommits(windowDays: number): Promise<RepositoryCommitActivity[]> {
  const response = await octokit.repos.listCommits({
    owner,
    repo,
    since: toIsoDaysAgo(windowDays),
    per_page: 100,
  });

  return response.data.map(commit => ({
    sha: commit.sha,
    message: commit.commit.message,
    url: commit.html_url,
    committedAt: commit.commit.committer?.date ?? '',
  }));
}
