-- Preserve content IDs, answers, progress and retry receipts while removing lesson sequencing.
UPDATE english_course SET title='图书馆的一个上午',payload=JSON_SET(payload,'$.article.title','A Morning at the Library') WHERE id='sentence-basics';
UPDATE english_course SET title='花园里的小改变',payload=JSON_SET(payload,'$.article.title','Small Changes in a Garden') WHERE id='word-forms';
UPDATE english_course SET title='社区阅读活动',payload=JSON_SET(payload,'$.article.title','A Community Reading Event') WHERE id='context-meanings';
UPDATE english_course SET title='改变计划的一天',payload=JSON_SET(payload,'$.article.title','A Change of Plan') WHERE id='phrases';
UPDATE english_course SET title='新友谊的开始',payload=JSON_SET(payload,'$.article.title','A New Beginning') WHERE id='longer-sentences';
