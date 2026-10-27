from __future__ import annotations

import unittest

from privatespace_sync.__main__ import build_parser


class CliTests(unittest.TestCase):
    def test_program_name_is_stable(self) -> None:
        parser = build_parser()

        self.assertEqual(parser.prog, "privatespace-sync")


if __name__ == "__main__":
    unittest.main()
