import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideDocxCommitMetadata,
  rewriteDocxMediaReferences,
  extractImageUrls,
  validateDocxImageReferences,
} from './build-content.mjs';

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

test('Word 图片的 Windows 绝对路径会改成站内地址', () => {
  const mediaSrc = 'D:\\My Project\\CY\\generated\\.tmp-docx\\示例\\media';
  const body =
    '<img src="D:\\My Project\\CY\\generated\\.tmp-docx\\示例/media/image1.png" style="width:6.5in" />';
  const rewritten = rewriteDocxMediaReferences(body, {
    mediaSrc,
    publicPrefix: '/media/articles/示例',
  });

  assert.match(rewritten, /src="\/media\/articles\/示例\/image1\.png"/);
  assert.doesNotMatch(rewritten, /D:\\My Project/);
});

test('Word 图片的 Linux 绝对路径会改成站内地址', () => {
  const mediaSrc =
    '/home/runner/work/cy-site/cy-site/generated/.tmp-docx/示例/media';
  const body =
    '![截图](/home/runner/work/cy-site/cy-site/generated/.tmp-docx/示例/media/image2.png)';
  const rewritten = rewriteDocxMediaReferences(body, {
    mediaSrc,
    publicPrefix: '/media/articles/示例',
  });

  assert.equal(rewritten, '![截图](/media/articles/示例/image2.png)');
});

test('Word 图片的相对路径和特殊文件名会安全转换', () => {
  const rewritten = rewriteDocxMediaReferences(
    '<img src="./media/截图%20%231.png" /><img src="https://example.com/cover.png" />',
    {
      mediaSrc: '/tmp/article/media',
      publicPrefix: '/media/articles/示例',
    }
  );

  assert.deepEqual(extractImageUrls(rewritten), [
    '/media/articles/示例/%E6%88%AA%E5%9B%BE%20%231.png',
    'https://example.com/cover.png',
  ]);
});

test('Word 图片文件缺失时构建会直接失败', async () => {
  await assert.rejects(
    () =>
      validateDocxImageReferences(
        '<img src="/media/articles/__test-missing__/image404.png" />',
        '__test-missing__'
      ),
    /图片文件缺失/
  );
});
