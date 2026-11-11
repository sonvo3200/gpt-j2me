{ pkgs, ... }: {
  channel = "stable-24.05";

  packages = [
    pkgs.nodejs_22
    pkgs.jdk21
  ];

  env = {};

  idx = {
    extensions = [];

    previews = {
      enable = true;
      previews = {
        web = {
          command = ["npm" "run" "dev" "--" "--port" "$PORT" "--host" "0.0.0.0"];
          manager = "web";
        };
      };
    };

    workspace = {
      onCreate = {
        npm-install = "npm ci";
      };
      onStart = {};
    };
  };
}

