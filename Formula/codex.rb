# CODEX admin CLI - see cli/README.md for what it does and how it's
# structured. This formula installs the `cli/` subdirectory of the main
# SOPGenerator repo, not a separate package - Homebrew still requires the
# Formula file itself to live at this path (Formula/codex.rb) for a tap to
# find it.
class Codex < Formula
  desc "Admin CLI for managing CODEX users and departments"
  homepage "https://github.com/tayC1/SOPGenerator"
  url "https://github.com/tayC1/SOPGenerator/archive/refs/tags/cli-v1.0.0.tar.gz"
  sha256 "REPLACE_WITH_SHA256_AFTER_TAGGING_A_RELEASE"
  license "UNLICENSED"

  depends_on "node"

  def install
    cd "cli" do
      system "npm", "install", *Language::Node.std_npm_install_args(libexec)
      bin.install_symlink Dir["#{libexec}/bin/*"]
    end
  end

  test do
    assert_match "Usage", shell_output("#{bin}/codex --help")
  end
end
