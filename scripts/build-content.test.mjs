import test from 'node:test';
import assert from 'node:assert/strict';
import { decideDocxCommitMetadata } from './build-content.mjs';

const article = 'articles/2026-08-13-示例.docx';

test('旧文章不读取历史提交信息', () => {
  assert.equal(
    decideDocxCommitMetadata({
      markerEnabled: false,
      changedPaths: [article],
      relativePath: article,
      subject: '旧提交名称',
      body: '',
    }),
    null
  );
});

test('新 Word 使用提交名称和描述，并压平多余空白', () => {
  assert.deepEqual(
    decideDocxCommitMetadata({
      markerEnabled: true,
      changedPaths: [article],
      relativePath: article,
      subject: '  我的文章  ',
      body: '第一行摘要\n\n第二行摘要',
    }),
    { title: '我的文章', summary: '第一行摘要 第二行摘要' }
  );
});

test('新 Word 缺少提交描述时失败', () => {
  assert.throws(
    () =>
      decideDocxCommitMetadata({
        markerEnabled: true,
        changedPaths: [article],
        relativePath: article,
        subject: '我的文章',
        body: '',
      }),
    /缺少提交描述/
  );
});

test('Word 与网站代码混在一次提交时失败', () => {
  assert.throws(
    () =>
      decideDocxCommitMetadata({
        markerEnabled: true,
        changedPaths: [article, 'src/pages/index.astro'],
        relativePath: article,
        subject: '我的文章',
        body: '摘要',
      }),
    /必须单独提交/
  );
});
