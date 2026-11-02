"""Server-owned device selection. Library paths remain unchanged in the local root."""

from .filesystem import valid_path, excluded
from .transport import SyncError


class SyncScope:
    def __init__(self, scope=None, attachments=()):
        scope = scope or {'all': True, 'folders': []}
        if not isinstance(scope, dict) or type(scope.get('all')) is not bool or not isinstance(scope.get('folders'), list):
            raise SyncError('INVALID_SCOPE_RESPONSE')
        roots = scope['folders']
        if len(roots) > 100 or any(not isinstance(root, str) or not valid_path(root) or excluded(root) for root in roots):
            raise SyncError('INVALID_SCOPE_RESPONSE')
        if scope['all'] and roots or not scope['all'] and not roots:
            raise SyncError('INVALID_SCOPE_RESPONSE')
        if not isinstance(attachments, (list, tuple)) or any(not isinstance(path, str) or not valid_path(path) for path in attachments):
            raise SyncError('INVALID_SCOPE_RESPONSE')
        self.all = scope['all']
        self.folders = tuple(roots)
        self.attachments = frozenset(path for path in attachments if not excluded(path))

    def explicit(self, path):
        return self.all or any(path.startswith(root + '/') for root in self.folders)

    def includes(self, path):
        return self.explicit(path) or path in self.attachments

    def directory(self, path):
        return self.all or any(path == root or path.startswith(root + '/') for root in self.folders)

    def descends(self, path):
        return (self.all or any(path == root or path.startswith(root + '/') or root.startswith(path + '/') for root in self.folders)
                or any(attachment.startswith(path + '/') for attachment in self.attachments))

    def data(self):
        return {'all': self.all, 'folders': list(self.folders)}
