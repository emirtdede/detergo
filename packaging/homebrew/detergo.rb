cask "detergo" do
  version "1.0.0"
  sha256 :no_check

  url "https://github.com/emirtdede/detergo/releases/download/v#{version}/Detergo_#{version}_macos_universal.dmg"
  name "Detergo"
  desc "Local-first developer workspace, AI coding agent, Xcode, and tool cache cleaner"
  homepage "https://github.com/emirtdede/detergo"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "Detergo.app"
  binary "#{appdir}/Detergo.app/Contents/MacOS/detergo"

  zap trash: [
    "~/Library/Application Support/com.vellium.detergo",
    "~/Library/Caches/com.vellium.detergo",
    "~/Library/Preferences/com.vellium.detergo.plist",
  ]
end
